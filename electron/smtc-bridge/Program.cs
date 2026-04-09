using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using Windows.Media;
using Windows.Media.Playback;
using Windows.Storage.Streams;

internal sealed class NativeSmtcBridge : IDisposable {
    private readonly MediaPlayer _player;
    private readonly SystemMediaTransportControls _smtc;
    private readonly object _sync = new();
    private readonly DiscordIpcClient _discordClient;
    private readonly object _discordPresenceSync = new();
    private Timer? _discordDebounceTimer;
    private PendingDiscordPresence? _pendingDiscordPresence;
    private long _discordPresenceRevision;

    private string? _lastDiscordIdentity;
    private bool _lastDiscordIsPlaying;
    private double _lastDiscordPositionSec;
    private DateTime _lastDiscordSyncedAtUtc;

    private const string DefaultDiscordClientId = "1483796229774114826";
    private const double DiscordSeekResyncThresholdSec = 3.5;
    private const int DiscordTrackSwitchDebounceMs = 700;
    private const int DiscordDetailsMaxLength = 128;
    private const int DiscordStateMaxLength = 128;
    private const int SmtcTitleMaxLength = 96;
    private const int SmtcArtistMaxLength = 96;

    public NativeSmtcBridge() {
        _player = new MediaPlayer();
        _smtc = _player.SystemMediaTransportControls;
        _smtc.IsEnabled = true;
        _smtc.IsPlayEnabled = true;
        _smtc.IsPauseEnabled = true;
        _smtc.IsNextEnabled = true;
        _smtc.IsPreviousEnabled = true;
        _smtc.IsStopEnabled = true;
        _smtc.PlaybackStatus = MediaPlaybackStatus.Closed;
        _smtc.DisplayUpdater.Type = MediaPlaybackType.Music;
        _smtc.ButtonPressed += OnButtonPressed;

        _discordClient = new DiscordIpcClient(GetDiscordClientId());
        _discordClient.Initialize();
    }

    private void OnButtonPressed(SystemMediaTransportControls sender, SystemMediaTransportControlsButtonPressedEventArgs args) {
        var action = args.Button switch {
            SystemMediaTransportControlsButton.Play => "play",
            SystemMediaTransportControlsButton.Pause => "pause",
            SystemMediaTransportControlsButton.Stop => "stop",
            SystemMediaTransportControlsButton.Next => "next",
            SystemMediaTransportControlsButton.Previous => "previous",
            _ => null
        };

        if (action is null) {
            return;
        }

        lock (_sync) {
            Console.WriteLine(JsonSerializer.Serialize(new { type = "action", action }));
        }
    }

    public void Clear() {
        _smtc.DisplayUpdater.MusicProperties.Title = "Soundtify";
        _smtc.DisplayUpdater.MusicProperties.Artist = "";
        _smtc.PlaybackStatus = MediaPlaybackStatus.Stopped;
        _smtc.DisplayUpdater.Update();

        ClearDiscordPresence();
    }

    public void Update(MediaUpdatePayload payload) {
        _smtc.PlaybackStatus = payload.IsPlaying ? MediaPlaybackStatus.Playing : MediaPlaybackStatus.Paused;
        _smtc.DisplayUpdater.MusicProperties.Title = TruncateWithEllipsis(payload.Title ?? "Unknown track", SmtcTitleMaxLength);
        _smtc.DisplayUpdater.MusicProperties.Artist = TruncateWithEllipsis(payload.Artist ?? "Unknown artist", SmtcArtistMaxLength);

        if (!string.IsNullOrWhiteSpace(payload.ArtworkUrl) &&
            Uri.TryCreate(payload.ArtworkUrl, UriKind.Absolute, out var artworkUri))
        {
            _smtc.DisplayUpdater.Thumbnail = RandomAccessStreamReference.CreateFromUri(new Uri(artworkUri.ToString()));
        }

        _smtc.DisplayUpdater.Update();

        var timeline = new SystemMediaTransportControlsTimelineProperties {
            StartTime = TimeSpan.Zero,
            EndTime = TimeSpan.FromSeconds(Math.Max(1, payload.DurationSec)),
            MinSeekTime = TimeSpan.Zero,
            MaxSeekTime = TimeSpan.FromSeconds(Math.Max(1, payload.DurationSec)),
            Position = TimeSpan.FromSeconds(Math.Max(0, Math.Min(payload.PositionSec, payload.DurationSec)))
        };
        _smtc.UpdateTimelineProperties(timeline);

        UpdateDiscordPresence(payload);
    }

    private void UpdateDiscordPresence(MediaUpdatePayload payload) {
        if (!payload.IsPlaying) {
            CancelPendingDiscordActivity();
            ClearDiscordPresence();
            return;
        }

        if (!_discordClient.IsInitialized) {
            _discordClient.Initialize();
        }

        if (!_discordClient.IsInitialized) {
            return;
        }

        var rawTrackTitle = payload.Title ?? "Unknown track";
        var rawArtistName = payload.Artist ?? "Unknown artist";
        var trackTitle = TruncateWithEllipsis(rawTrackTitle, DiscordDetailsMaxLength);
        var artistName = TruncateWithEllipsis(rawArtistName, DiscordStateMaxLength);
        var safeTrackUrl = IsHttpUrl(payload.TrackUrl) ? payload.TrackUrl : null;
        var safeArtworkUrl = IsHttpUrl(payload.ArtworkUrl) ? payload.ArtworkUrl : null;
        var now = DateTime.UtcNow;
        var safeDurationSec = Math.Max(1, payload.DurationSec);
        var safePositionSec = Math.Max(0, Math.Min(safeDurationSec, payload.PositionSec));

        var identity = string.Join("|", rawTrackTitle, rawArtistName, safeArtworkUrl ?? "", safeTrackUrl ?? "");
        var shouldResync =
            !string.Equals(_lastDiscordIdentity, identity, StringComparison.Ordinal) ||
            !_lastDiscordIsPlaying ||
            Math.Abs(safePositionSec - GetExpectedDiscordPosition(now)) > DiscordSeekResyncThresholdSec;

        if (!shouldResync) return;

        try {
            var start = now - TimeSpan.FromSeconds(safePositionSec);
            var end = start + TimeSpan.FromSeconds(safeDurationSec);
            var activity = new DiscordActivity {
                Type = 2, // LISTENING
                Details = trackTitle,
                State = artistName,
                StartUnixSeconds = ToUnixSeconds(start),
                EndUnixSeconds = ToUnixSeconds(end),
                LargeImage = safeArtworkUrl,
                SmallText = "Listening on Soundtify",
                ButtonLabel = safeTrackUrl is not null ? "Open Track" : null,
                ButtonUrl = safeTrackUrl
            };

            var isTrackSwitch = !string.Equals(_lastDiscordIdentity, identity, StringComparison.Ordinal);
            if (isTrackSwitch) {
                Program.LogDebug($"Queueing Discord presence after debounce: title='{trackTitle}', artist='{artistName}'");
                QueueDiscordActivity(activity, identity, safePositionSec, now);
            }
            else {
                ApplyDiscordActivityImmediately(activity, identity, safePositionSec, now);
            }
        }
        catch (Exception ex) {
            Program.LogError($"Discord IPC update failed: {ex.Message}");
        }
    }

    private void ClearDiscordPresence() {
        CancelPendingDiscordActivity();
        try {
            _discordClient.ClearActivity();
        }
        catch (Exception ex) {
            Program.LogError($"Discord IPC clear failed: {ex.Message}");
        }

        _lastDiscordIdentity = null;
        _lastDiscordIsPlaying = false;
        _lastDiscordPositionSec = 0;
        _lastDiscordSyncedAtUtc = DateTime.MinValue;
    }

    private void QueueDiscordActivity(DiscordActivity activity, string identity, double positionSec, DateTime syncedAtUtc) {
        lock (_discordPresenceSync) {
            if (_pendingDiscordPresence is not null &&
                string.Equals(_pendingDiscordPresence.Identity, identity, StringComparison.Ordinal))
            {
                _pendingDiscordPresence = _pendingDiscordPresence with {
                    Activity = activity,
                    PositionSec = positionSec,
                    SyncedAtUtc = syncedAtUtc
                };
                Program.LogDebug($"Refreshing pending Discord presence without resetting debounce: title='{activity.Details}'");
                return;
            }

            var revision = ++_discordPresenceRevision;
            _pendingDiscordPresence = new PendingDiscordPresence(
                activity,
                identity,
                positionSec,
                syncedAtUtc,
                revision
            );

            _discordDebounceTimer?.Dispose();
            _discordDebounceTimer = CreateDiscordDebounceTimer();
        }
    }

    private Timer CreateDiscordDebounceTimer() {
        return new Timer(_ => {
            PendingDiscordPresence? pendingToApply;
            lock (_discordPresenceSync) {
                pendingToApply = _pendingDiscordPresence;
                _pendingDiscordPresence = null;
                _discordDebounceTimer?.Dispose();
                _discordDebounceTimer = null;
            }

            if (pendingToApply is null) {
                return;
            }

            ApplyDiscordActivity(
                pendingToApply.Activity,
                pendingToApply.Identity,
                pendingToApply.PositionSec,
                pendingToApply.SyncedAtUtc,
                pendingToApply.Revision
            );
        }, null, DiscordTrackSwitchDebounceMs, Timeout.Infinite);
    }

    private void CancelPendingDiscordActivity() {
        lock (_discordPresenceSync) {
            _discordPresenceRevision++;
            _pendingDiscordPresence = null;
            _discordDebounceTimer?.Dispose();
            _discordDebounceTimer = null;
        }
    }

    private void ApplyDiscordActivityImmediately(DiscordActivity activity, string identity, double positionSec, DateTime syncedAtUtc) {
        long revision;
        lock (_discordPresenceSync) {
            _discordPresenceRevision++;
            revision = _discordPresenceRevision;
            _pendingDiscordPresence = null;
            _discordDebounceTimer?.Dispose();
            _discordDebounceTimer = null;
        }

        ApplyDiscordActivity(activity, identity, positionSec, syncedAtUtc, revision);
    }

    private void ApplyDiscordActivity(DiscordActivity activity, string identity, double positionSec, DateTime syncedAtUtc, long revision) {
        lock (_discordPresenceSync) {
            if (revision != _discordPresenceRevision) {
                Program.LogDebug($"Skipping stale Discord presence: title='{activity.Details}', revision={revision}, current={_discordPresenceRevision}");
                return;
            }
        }

        if (!_discordClient.IsInitialized) {
            _discordClient.Initialize();
        }

        if (!_discordClient.IsInitialized) {
            Program.LogError($"Discord IPC not ready, dropping activity '{activity.Details}'");
            return;
        }

        Program.LogDebug($"Applying Discord presence: title='{activity.Details}', artist='{activity.State}', pos={positionSec:F1}, revision={revision}");
        _discordClient.SetActivity(activity);
        _lastDiscordIdentity = identity;
        _lastDiscordIsPlaying = true;
        _lastDiscordPositionSec = positionSec;
        _lastDiscordSyncedAtUtc = syncedAtUtc;
    }

    private double GetExpectedDiscordPosition(DateTime now) {
        if (_lastDiscordSyncedAtUtc == DateTime.MinValue || !_lastDiscordIsPlaying) {
            return _lastDiscordPositionSec;
        }

        return _lastDiscordPositionSec + (now - _lastDiscordSyncedAtUtc).TotalSeconds;
    }

    public void Dispose() {
        CancelPendingDiscordActivity();
        ClearDiscordPresence();
        _discordClient.Dispose();
        _player.Dispose();
    }

    private static long ToUnixSeconds(DateTime dateTimeUtc) {
        return new DateTimeOffset(dateTimeUtc).ToUnixTimeSeconds();
    }

    private static bool IsHttpUrl(string? value) {
        return !string.IsNullOrWhiteSpace(value) &&
               Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static string TruncateWithEllipsis(string? value, int maxLength) {
        var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        if (maxLength <= 0 || normalized.Length <= maxLength)
        {
            return normalized;
        }

        if (maxLength <= 3)
        {
            return normalized[..maxLength];
        }

        return normalized[..(maxLength - 3)].TrimEnd() + "...";
    }

    private static string GetDiscordClientId() {
        var configured = Environment.GetEnvironmentVariable("DISCORD_CLIENT_ID");
        return string.IsNullOrWhiteSpace(configured) ? DefaultDiscordClientId : configured.Trim();
    }
}

internal sealed class DiscordIpcClient : IDisposable {
    private const int HandshakeOpcode = 0;
    private const int FrameOpcode = 1;
    private const int CloseOpcode = 2;
    private const int PingOpcode = 3;
    private const int PongOpcode = 4;

    private readonly string _clientId;
    private readonly object _sync = new();

    private NamedPipeClientStream? _pipe;
    private CancellationTokenSource? _readCancellation;
    private Task? _readLoopTask;
    private volatile bool _isReady;

    public bool IsInitialized => _pipe?.IsConnected == true && _isReady;

    public DiscordIpcClient(string clientId) {
        _clientId = clientId;
    }

    public void Initialize() {
        lock (_sync) {
            if (IsInitialized) {
                return;
            }

            DisposePipe();

            for (var i = 0; i < 10; i++) {
                var candidate = $"discord-ipc-{i}";
                var pipe = new NamedPipeClientStream(".", candidate, PipeDirection.InOut, PipeOptions.Asynchronous);

                try {
                    pipe.Connect(150);
                    Program.LogDebug($"Connected to pipe {candidate}");
                    _pipe = pipe;
                    _isReady = false;
                    _readCancellation = new CancellationTokenSource();

                    SendFrame(HandshakeOpcode, new {
                        v = 1,
                        client_id = _clientId
                    });
                    Program.LogDebug("Handshake sent");

                    _readLoopTask = Task.Run(() => ReadLoopAsync(_readCancellation.Token));
                    return;
                }
                catch {
                    pipe.Dispose();
                }
            }
        }
    }

    public void SetActivity(DiscordActivity activity) {
        if (!IsInitialized) {
            Program.LogDebug("Skip SetActivity because client is not ready");
            return;
        }

        var activityPayload = new Dictionary<string, object?> {
            ["type"] = activity.Type,
            ["details"] = activity.Details,
            ["state"] = activity.State,
            ["instance"] = false
        };

        var timestamps = new Dictionary<string, object?>();
        if (activity.StartUnixSeconds is not null) {
            timestamps["start"] = activity.StartUnixSeconds.Value;
        }
        if (activity.EndUnixSeconds is not null) {
            timestamps["end"] = activity.EndUnixSeconds.Value;
        }
        if (timestamps.Count > 0) {
            activityPayload["timestamps"] = timestamps;
        }

        var assets = new Dictionary<string, object?>();
        if (!string.IsNullOrWhiteSpace(activity.LargeImage)) {
            assets["large_image"] = activity.LargeImage;
        }
        if (!string.IsNullOrWhiteSpace(activity.LargeText)) {
            assets["large_text"] = activity.LargeText;
        }
        if (!string.IsNullOrWhiteSpace(activity.SmallText)) {
            assets["small_text"] = activity.SmallText;
        }
        if (assets.Count > 0) {
            activityPayload["assets"] = assets;
        }

        if (!string.IsNullOrWhiteSpace(activity.ButtonLabel) && !string.IsNullOrWhiteSpace(activity.ButtonUrl)) {
            activityPayload["buttons"] = new[] {
                new Dictionary<string, string?> {
                    ["label"] = activity.ButtonLabel,
                    ["url"] = activity.ButtonUrl
                }
            };
        }

        SendCommand("SET_ACTIVITY", new {
            pid = Process.GetCurrentProcess().Id,
            activity = activityPayload
        });
    }

    public void ClearActivity() {
        if (!IsInitialized) {
            Program.LogDebug("Skip ClearActivity because client is not ready");
            return;
        }

        SendCommand("SET_ACTIVITY", new {
            pid = Process.GetCurrentProcess().Id,
            activity = (object?)null
        });
    }

    private void SendCommand(string command, object args) {
        Program.LogDebug($"Sending command {command}");
        SendFrame(FrameOpcode, new {
            cmd = command,
            args,
            nonce = Guid.NewGuid().ToString("N")
        });
    }

    private void SendFrame(int opcode, object payload) {
        var pipe = _pipe;
        if (pipe is null || !pipe.IsConnected) {
            return;
        }

        var json = JsonSerializer.Serialize(payload);
        var payloadBytes = Encoding.UTF8.GetBytes(json);
        var header = new byte[8];

        BitConverter.GetBytes(opcode).CopyTo(header, 0);
        BitConverter.GetBytes(payloadBytes.Length).CopyTo(header, 4);

        lock (_sync) {
            try {
                pipe.Write(header, 0, header.Length);
                pipe.Write(payloadBytes, 0, payloadBytes.Length);
                pipe.Flush();
            }
            catch (Exception ex) {
                Console.Error.WriteLine($"[DiscordIPC] SendFrame failed: {ex.Message}");
                DisposePipe();
            }
        }
    }

    private async Task ReadLoopAsync(CancellationToken cancellationToken) {
        var header = new byte[8];

        try {
            while (!cancellationToken.IsCancellationRequested && _pipe is not null && _pipe.IsConnected) {
                await ReadExactlyAsync(_pipe, header, cancellationToken);
                var opcode = BitConverter.ToInt32(header, 0);
                var length = BitConverter.ToInt32(header, 4);

                if (length < 0 || length > 1024 * 1024) {
                    throw new InvalidOperationException("Unexpected Discord IPC frame length");
                }

                var payloadBytes = new byte[length];
                await ReadExactlyAsync(_pipe, payloadBytes, cancellationToken);
                var payload = Encoding.UTF8.GetString(payloadBytes);
                Program.LogDebug($"Received opcode={opcode} payload={payload}");

                if (opcode == PingOpcode) {
                    SendRawFrame(PongOpcode, payloadBytes);
                }
                else if (opcode == CloseOpcode) {
                    break;
                }
                else {
                    HandleIncomingPayload(payload);
                }
            }
        }
        catch (Exception ex) {
            Console.Error.WriteLine($"[DiscordIPC] Read loop failed: {ex.Message}");
        }
        finally {
            DisposePipe();
        }
    }

    private void SendRawFrame(int opcode, byte[] payloadBytes) {
        var pipe = _pipe;
        if (pipe is null || !pipe.IsConnected) {
            return;
        }

        var header = new byte[8];
        BitConverter.GetBytes(opcode).CopyTo(header, 0);
        BitConverter.GetBytes(payloadBytes.Length).CopyTo(header, 4);

        lock (_sync) {
            try {
                pipe.Write(header, 0, header.Length);
                pipe.Write(payloadBytes, 0, payloadBytes.Length);
                pipe.Flush();
            }
            catch (Exception ex) {
                Console.Error.WriteLine($"[DiscordIPC] SendRawFrame failed: {ex.Message}");
                DisposePipe();
            }
        }
    }

    private void HandleIncomingPayload(string payload) {
        try {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;

            if (root.TryGetProperty("evt", out var evtProperty)) {
                var evt = evtProperty.GetString();
                if (string.Equals(evt, "READY", StringComparison.OrdinalIgnoreCase)) {
                    _isReady = true;
                    Program.LogDebug("Discord client is READY");
                }
                else if (string.Equals(evt, "ERROR", StringComparison.OrdinalIgnoreCase)) {
                    Console.Error.WriteLine($"[DiscordIPC] Discord returned ERROR payload: {payload}");
                }
            }
        }
        catch (Exception ex) {
            Console.Error.WriteLine($"[DiscordIPC] Failed to parse incoming payload: {ex.Message}");
        }
    }

    private static async Task ReadExactlyAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken) {
        var offset = 0;
        while (offset < buffer.Length) {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellationToken);
            if (read == 0) {
                throw new EndOfStreamException();
            }
            offset += read;
        }
    }

    public void Dispose() {
        DisposePipe();
    }

    private void DisposePipe() {
        _isReady = false;
        try {
            _readCancellation?.Cancel();
        }
        catch {}

        _readCancellation?.Dispose();
        _readCancellation = null;

        try {
            _pipe?.Dispose();
        }
        catch {}

        _pipe = null;
        _readLoopTask = null;
    }
}

internal sealed class DiscordActivity {
    public int Type { get; set; }
    public string? Details { get; set; }
    public string? State { get; set; }
    public long? StartUnixSeconds { get; set; }
    public long? EndUnixSeconds { get; set; }
    public string? LargeImage { get; set; }
    public string? LargeText { get; set; }
    public string? SmallText { get; set; }
    public string? ButtonLabel { get; set; }
    public string? ButtonUrl { get; set; }
}

internal sealed record PendingDiscordPresence(
    DiscordActivity Activity,
    string Identity,
    double PositionSec,
    DateTime SyncedAtUtc,
    long Revision
);

internal sealed class MediaUpdatePayload {
    public string? Title { get; set; }
    public string? Artist { get; set; }
    public string? ArtworkUrl { get; set; }
    public string? TrackUrl { get; set; }
    public bool IsPlaying { get; set; }
    public double DurationSec { get; set; }
    public double PositionSec { get; set; }
}

internal sealed class BridgeMessage {
    public string? Type { get; set; }
    public MediaUpdatePayload? Payload { get; set; }
}

internal static class Program {
    private const string AppUserModelId = "com.rixxieq.soundtify";

    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNameCaseInsensitive = true
    };

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    public static readonly bool VerboseLoggingEnabled =
        string.Equals(Environment.GetEnvironmentVariable("SMTC_DEBUG"), "1", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(Environment.GetEnvironmentVariable("SMTC_DEBUG"), "true", StringComparison.OrdinalIgnoreCase);

    public static void LogDebug(string message) {
        if (!VerboseLoggingEnabled) {
            return;
        }
        try {
            Console.Error.WriteLine($"[DiscordIPC] {message}");
        }
        catch {}
    }

    public static void LogError(string message) {
        try {
            Console.Error.WriteLine($"[DiscordIPC] {message}");
        }
        catch {}
    }

    private static async Task<int> Main() {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;
        _ = SetCurrentProcessExplicitAppUserModelID(AppUserModelId);

        using var bridge = new NativeSmtcBridge();
        bridge.Clear();
        Console.WriteLine(JsonSerializer.Serialize(new { type = "ready" }));

        while (true) {
            var line = await Console.In.ReadLineAsync();
            if (line is null) {
                break;
            }

            if (string.IsNullOrWhiteSpace(line)) {
                continue;
            }

            BridgeMessage? message;
            try {
                message = JsonSerializer.Deserialize<BridgeMessage>(line, JsonOptions);
            }
            catch {
                continue;
            }

            if (message?.Type is null) {
                continue;
            }

            if (string.Equals(message.Type, "clear", StringComparison.OrdinalIgnoreCase)) {
                bridge.Clear();
                continue;
            }

            if (string.Equals(message.Type, "update", StringComparison.OrdinalIgnoreCase) && message.Payload is not null) {
                bridge.Update(message.Payload);
            }
        }

        return 0;
    }
}
