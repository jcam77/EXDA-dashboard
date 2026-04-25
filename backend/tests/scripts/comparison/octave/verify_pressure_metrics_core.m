function metrics = verify_pressure_metrics_core(csvPath, varargin)
% verify_pressure_metrics_core
% Reproduces EXDA pressure metric logic for cross-checking in MATLAB/Octave.
%
% Usage:
%   metrics = verify_pressure_metrics_core("experimental_data_001_noisy.csv", ...
%       "DecayPercent", 50, "CutoffHz", 20, "Order", 4, "UseRaw", false);
%
% Notes:
% - DecayPercent uses UI meaning: 0..99.9 (% allowed drop from Pmax).
% - End threshold is mapped as: thresholdFraction = (100 - DecayPercent)/100.
% - If pressure magnitude suggests Pa units (abs max > 1000), it applies:
%       y_kPa = (y - 101325) / 1000

opts = parseInputs(varargin{:});

data = readCsvMatrix(csvPath);
if size(data, 2) < 2
    error("Expected at least 2 columns (time, pressure) in %s", csvPath);
end
t = data(:, 1);
y = data(:, 2);

% Match backend parser sorting behavior.
[t, idx] = sort(t);
y = y(idx);

% Match backend pressure unit normalization behavior.
if max(abs(y)) > 1000
    y = (y - 101325.0) ./ 1000.0;
end

if opts.UseRaw
    tProc = t;
    yProc = y;
else
    [tProc, yProc] = applyButterworthLikeBackend(t, y, opts.CutoffHz, opts.Order);
end

thresholdFraction = decayToThresholdFraction(opts.DecayPercent);
[pMax, tMax, impulse, status, idxCutoff] = calculateMetricsLikeBackend(tProc, yProc, thresholdFraction);

metrics = struct();
metrics.decayPercent = opts.DecayPercent;
metrics.thresholdPercent = thresholdFraction * 100.0;
metrics.pMax = pMax;
metrics.tMax = tMax;
metrics.impulse = impulse;
metrics.status = status;
metrics.idxCutoff = idxCutoff;

fprintf("EXDA-style pressure metrics\n");
fprintf("  pMax: %.6f\n", metrics.pMax);
fprintf("  tMax: %.6f\n", metrics.tMax);
fprintf("  impulse: %.6f\n", metrics.impulse);
fprintf("  status: %s\n", metrics.status);
end

function opts = parseInputs(varargin)
    p = inputParser;
    addParameter(p, "DecayPercent", 95.0, @(x) isnumeric(x) && isscalar(x));
    addParameter(p, "CutoffHz", 100.0, @(x) isnumeric(x) && isscalar(x));
    addParameter(p, "Order", 4, @(x) isnumeric(x) && isscalar(x));
    addParameter(p, "UseRaw", false, @(x) islogical(x) || isnumeric(x));
    parse(p, varargin{:});
    opts = p.Results;
end

function thresholdFraction = decayToThresholdFraction(decayPercent)
    d = double(decayPercent);
    if ~isfinite(d)
        d = 95.0;
    end
    d = min(max(d, 0.0), 99.9);
    thresholdFraction = (100.0 - d) / 100.0;
    thresholdFraction = min(max(thresholdFraction, 0.001), 1.0);
end

function [tUni, yUni, fsRef] = resampleUniform(t, y)
    if numel(t) < 2
        tUni = t;
        yUni = y;
        fsRef = 1.0;
        return;
    end
    dtRaw = diff(t);
    dtRaw = dtRaw(dtRaw > 0);
    if isempty(dtRaw)
        tUni = t;
        yUni = y;
        fsRef = 1.0;
        return;
    end
    dtRef = median(dtRaw);
    fsRef = 1.0 / dtRef;
    n = round((t(end) - t(1)) * fsRef) + 1;
    tUni = linspace(t(1), t(end), n).';
    yUni = interp1(t, y, tUni, "linear");
end

function [tOut, yOut] = applyButterworthLikeBackend(t, y, cutoffHz, order)
    persistent warnedFilterFallback;
    if numel(t) < 10
        tOut = t;
        yOut = y;
        return;
    end

    [tUni, yUni, fs] = resampleUniform(t, y);
    if cutoffHz >= 0.5 * fs
        tOut = tUni;
        yOut = yUni;
        return;
    end

    try
        % Octave needs the signal package for butter/filtfilt.
        if exist("pkg", "file") == 2
            try
                pkg("load", "signal");
            catch
            end
        end
        [b, a] = butter(round(order), cutoffHz / (0.5 * fs), "low");
        yFilt = filtfilt(b, a, yUni);
        tOut = tUni;
        yOut = yFilt;
    catch
        if isempty(warnedFilterFallback) || ~warnedFilterFallback
            fprintf("WARNING: Butterworth filter unavailable in MATLAB/Octave environment; using unfiltered resampled signal.\n");
            warnedFilterFallback = true;
        end
        % Match backend fallback strategy.
        tOut = tUni;
        yOut = yUni;
    end
end

function [pMax, tMax, impulse, status, idxCutoff] = calculateMetricsLikeBackend(t, y, thresholdFraction)
    if isempty(y)
        pMax = 0.0;
        tMax = 0.0;
        impulse = 0.0;
        status = "No Data";
        idxCutoff = 1;
        return;
    end

    [pMax, idxMax] = max(y);
    tMax = t(idxMax);
    if pMax <= 0
        impulse = 0.0;
        status = "Peak <= 0";
        idxCutoff = idxMax;
        return;
    end

    thresholdValue = thresholdFraction * pMax;
    postPeak = y(idxMax:end);
    idxRel = find(postPeak <= thresholdValue, 1, "first");
    if ~isempty(idxRel)
        idxCutoff = idxMax + idxRel - 1;
        status = sprintf("End threshold %.1f%% Pmax reached", thresholdFraction * 100.0);
    else
        idxCutoff = numel(y);
        status = sprintf("End threshold %.1f%% Pmax not reached; integrated to end", thresholdFraction * 100.0);
    end

    impulse = trapz(t(1:idxCutoff), y(1:idxCutoff));
end

function data = readCsvMatrix(csvPath)
    if exist("readmatrix", "file") == 2 || exist("readmatrix", "builtin") == 5
        data = readmatrix(csvPath);
        return;
    end
    data = dlmread(csvPath, ",");
end
