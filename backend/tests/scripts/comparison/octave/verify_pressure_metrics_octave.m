% verify_pressure_metrics_octave.m
% Generate Octave pressure metrics CSV used by the EXDA verification page.
%
% Usage (from repo root):
%   octave --quiet backend/tests/scripts/comparison/octave/verify_pressure_metrics_octave.m
%
% Optional overrides through variables before running:
%   decayPercent, cutoffHz, filterOrder

scriptPath = mfilename("fullpath");
octaveDir = fileparts(scriptPath);
testsDir = fileparts(fileparts(fileparts(octaveDir)));
addpath(octaveDir);

if ~exist("decayPercent", "var")
    decayPercent = 95;
end
if ~exist("cutoffHz", "var")
    cutoffHz = 20;
end
if ~exist("filterOrder", "var")
    filterOrder = 4;
end

cleanPath = fullfile(testsDir, "reference_data", "experimental_data_001_clean.csv");
noisyPath = fullfile(testsDir, "reference_data", "experimental_data_001_noisy.csv");
outPath = fullfile(testsDir, "results", "pressure_metrics_octave.csv");

if ~exist(cleanPath, "file")
    error("Missing fixture: %s", cleanPath);
end
if ~exist(noisyPath, "file")
    error("Missing fixture: %s", noisyPath);
end

cleanRaw = verify_pressure_metrics_core(
    cleanPath,
    "DecayPercent", decayPercent,
    "CutoffHz", cutoffHz,
    "Order", filterOrder,
    "UseRaw", true
);

noisyRaw = verify_pressure_metrics_core(
    noisyPath,
    "DecayPercent", decayPercent,
    "CutoffHz", cutoffHz,
    "Order", filterOrder,
    "UseRaw", true
);

noisyFiltered = verify_pressure_metrics_core(
    noisyPath,
    "DecayPercent", decayPercent,
    "CutoffHz", cutoffHz,
    "Order", filterOrder,
    "UseRaw", false
);

fid = fopen(outPath, "w");
if fid < 0
    error("Could not write output file: %s", outPath);
end

fprintf(fid, "series,pMax,tMax,impulse,status\n");
fprintf(fid, "clean_raw,%.5f,%.5f,%.5f,%s\n", cleanRaw.pMax, cleanRaw.tMax, cleanRaw.impulse, strrep(char(cleanRaw.status), ",", ";"));
fprintf(fid, "noisy_raw,%.5f,%.5f,%.5f,%s\n", noisyRaw.pMax, noisyRaw.tMax, noisyRaw.impulse, strrep(char(noisyRaw.status), ",", ";"));
fprintf(fid, "noisy_filtered,%.5f,%.5f,%.5f,%s\n", noisyFiltered.pMax, noisyFiltered.tMax, noisyFiltered.impulse, strrep(char(noisyFiltered.status), ",", ";"));

fclose(fid);

fprintf("Wrote pressure metrics CSV (Octave reference): %s\n", outPath);
fprintf("  decayPercent=%.3f cutoffHz=%.3f order=%d\n", decayPercent, cutoffHz, filterOrder);
