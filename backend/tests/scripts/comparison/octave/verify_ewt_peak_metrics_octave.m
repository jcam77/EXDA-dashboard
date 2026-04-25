% verify_ewt_peak_metrics_octave.m
% Export Octave EWT mode peak metrics for comparison against Python output.

scriptPath = mfilename("fullpath");
octaveDir = fileparts(scriptPath);
testsDir = fileparts(fileparts(fileparts(octaveDir)));
repoRoot = fileparts(fileparts(fileparts(fileparts(fileparts(octaveDir)))));

if exist("pkg", "file") == 2
    try
        pkg("load", "signal");
    catch
    end
end

toolboxPath = getenv("EWT_TOOLBOX_PATH");
if isempty(toolboxPath)
    candidates = {
        fullfile(repoRoot, "backend", "tests", "third_party", "Empirical-Wavelets-master"),
        fullfile(repoRoot, "backend", "tests", "third_party", "Empirical-Wavelets"),
        fullfile(repoRoot, "backend", "tests", "third_party", "ewt"),
    };
    for i = 1:numel(candidates)
        if exist(candidates{i}, "dir")
            toolboxPath = candidates{i};
            break;
        end
    end
end

if isempty(toolboxPath) || ~exist(toolboxPath, "dir")
    error("EWT toolbox path not found. Set EWT_TOOLBOX_PATH to your Empirical-Wavelets folder.");
end

addpath(genpath(toolboxPath));
if exist("EWT1D", "file") ~= 2
    error("EWT1D not found after adding toolbox path: %s", toolboxPath);
end

inputCsv = fullfile(testsDir, "reference_data", "experimental_data_001_noisy.csv");
octaveOutCsv = fullfile(testsDir, "results", "ewt_peak_metrics_octave.csv");
if ~exist(inputCsv, "file")
    error("Missing input fixture: %s", inputCsv);
end

if exist("readmatrix", "file") == 2 || exist("readmatrix", "builtin") == 5
    data = readmatrix(inputCsv);
else
    data = dlmread(inputCsv, ",");
end
if size(data, 2) < 2
    error("Expected at least two columns in %s", inputCsv);
end

t = data(:, 1);
y = data(:, 2);
[t, idx] = sort(t);
y = y(idx);
[t, uniqIdx] = unique(t);
y = y(uniqIdx);
if max(abs(y)) > 1000
    y = (y - 101325.0) ./ 1000.0;
end

if numel(t) < 2
    tUni = t;
    yUni = y;
    fs = 1.0;
else
    dtRaw = diff(t);
    dtRaw = dtRaw(dtRaw > 0);
    if isempty(dtRaw)
        tUni = t;
        yUni = y;
        fs = 1.0;
    else
        dtRef = median(dtRaw);
        fs = 1.0 / dtRef;
        n = max(2, round((t(end) - t(1)) * fs) + 1);
        tUni = linspace(t(1), t(end), n).';
        yUni = interp1(t, y, tUni, "linear");
    end
end

numModes = 5;
expectedSamples = numel(yUni);
params = EWTDefaultParams();
params.N = numModes;
params.log = 0;
params.wavname = "littlewood-paley";
params.reg = "none";

[ewt, ~, ~] = EWT1D(yUni, params);
if isempty(ewt)
    error("EWT decomposition returned empty modes.");
end

nModes = min(numModes, numel(ewt));
modes = zeros(nModes, expectedSamples);
for i = 1:nModes
    modeVec = ewt{i};
    if isempty(modeVec)
        continue;
    end
    modeVec = modeVec(:).';
    if numel(modeVec) == expectedSamples
        modes(i, :) = modeVec;
    else
        xSrc = linspace(0.0, 1.0, numel(modeVec));
        xDst = linspace(0.0, 1.0, expectedSamples);
        modes(i, :) = interp1(xSrc, modeVec, xDst, "linear");
    end
end

nModes = size(modes, 1);
peakHz = zeros(nModes, 1);
energyPct = zeros(nModes, 1);
energies = zeros(nModes, 1);
for i = 1:nModes
    modeVec = modes(i, :);
    energies(i) = sum(modeVec .^ 2);
    [pxx, f] = periodogram(modeVec, [], [], fs);
    valid = f > 0;
    if any(valid)
        fValid = f(valid);
        pValid = pxx(valid);
        [~, idxMax] = max(pValid);
        peakHz(i) = fValid(idxMax);
    else
        [~, idxMax] = max(pxx);
        peakHz(i) = f(idxMax);
    end
end
totalEnergy = sum(energies);
if totalEnergy > 0
    energyPct = (energies ./ totalEnergy) .* 100.0;
end

fid = fopen(octaveOutCsv, "w");
if fid < 0
    error("Could not write Octave EWT output: %s", octaveOutCsv);
end
fprintf(fid, "mode,peak_hz,energy_pct\n");
for i = 1:numel(peakHz)
    fprintf(fid, "%d,%.5f,%.5f\n", i - 1, peakHz(i), energyPct(i));
end
fclose(fid);

fprintf("Octave EWT peak export complete.\n");
fprintf("  Toolbox: %s\n", toolboxPath);
fprintf("  Octave output: %s\n", octaveOutCsv);
