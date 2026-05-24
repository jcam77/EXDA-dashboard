function Results = AuxFcn_H2_MFC_FillCalculator_000(V_chamber_m3, T_chamber_K, P_chamber_Pa, H2_volPct, T_std_K, P_std_Pa, MFC_setpoint_SLPM, makePlot, Ru, M_H2)
% AuxFcn_H2_MFC_FillCalculator_000
% Estimate the hydrogen amount required to reach target chamber
% concentrations during vented filling and, optionally, estimate injection
% time from the Alicat MFC setpoint expressed in standardized cubic meters
% per second.
%
% Inputs
%   V_chamber_m3          chamber free volume [m^3], scalar or per-test vector
%   T_chamber_K           chamber gas temperature [K], scalar or per-test vector
%   P_chamber_Pa          chamber absolute pressure [Pa], scalar or per-test vector
%   H2_volPct             target hydrogen concentration(s) [vol%]
%   T_std_K               standard temperature [K]
%   P_std_Pa              standard absolute pressure [Pa]
%   MFC_setpoint_SLPM     Alicat setpoint [SLPM], scalar or per-test vector,
%                         use NaN to skip injection time
%   makePlot              logical flag, true to generate a plot
%   Ru                    universal gas constant [J/(mol*K)]
%   M_H2                  hydrogen molar mass [kg/mol]
%

% Output
%   Results               struct with inputs, vectors, and optional table

assert(nargin == 10, ['AuxFcn_H2_MFC_FillCalculator_000 requires 10 inputs: ', ...
    'V_chamber_m3, T_chamber_K, P_chamber_Pa, H2_volPct, T_std_K, ', ...
    'P_std_Pa, MFC_setpoint_SLPM, makePlot, Ru, M_H2.']);

H2_volPct = H2_volPct(:);
nCases = numel(H2_volPct);

V_chamber_m3 = i_expandToCases(V_chamber_m3, nCases, 'V_chamber_m3');
T_chamber_K = i_expandToCases(T_chamber_K, nCases, 'T_chamber_K');
P_chamber_Pa = i_expandToCases(P_chamber_Pa, nCases, 'P_chamber_Pa');
MFC_setpoint_SLPM = i_expandToCases(MFC_setpoint_SLPM, nCases, 'MFC_setpoint_SLPM');

x_H2 = H2_volPct / 100;

assert(all(V_chamber_m3 > 0), 'V_chamber_m3 must be greater than zero.');
assert(all(T_chamber_K > 0), 'T_chamber_K must be greater than zero.');
assert(T_std_K > 0, 'T_std_K must be greater than zero.');
assert(all(P_chamber_Pa > 0), 'P_chamber_Pa must be greater than zero.');
assert(P_std_Pa > 0, 'P_std_Pa must be greater than zero.');
assert(all(x_H2 > 0 & x_H2 < 1), 'All hydrogen concentrations must be between 0 and 100 vol%%.');
assert(islogical(makePlot) && isscalar(makePlot), 'makePlot must be a logical scalar.');
assert(isnumeric(Ru) && isscalar(Ru) && Ru > 0, 'Ru must be a positive numeric scalar.');
assert(isnumeric(M_H2) && isscalar(M_H2) && M_H2 > 0, 'M_H2 must be a positive numeric scalar.');

n_total_mol = (P_chamber_Pa .* V_chamber_m3) ./ (Ru .* T_chamber_K);
n_H2_mol = x_H2 .* n_total_mol;

m_H2_kg = n_H2_mol * M_H2;
m_H2_injected_g = 1e3 * m_H2_kg;

V_H2_injected_m3 = (n_H2_mol .* Ru .* T_chamber_K) ./ P_chamber_Pa;
V_H2_std_m3 = (n_H2_mol .* Ru .* T_std_K) ./ P_std_Pa;
V_chamber_L = 1e3 * V_chamber_m3;
V_H2_injected_L = 1e3 * V_H2_injected_m3;
V_H2_std_L = 1e3 * V_H2_std_m3;
MFC_setpoint_std_m3_s = MFC_setpoint_SLPM * 1e-3 / 60;

injectionTime_min = nan(size(x_H2));
injectionTime_s = 60 * injectionTime_min;
validSetpoint = isfinite(MFC_setpoint_std_m3_s) & MFC_setpoint_std_m3_s > 0;
injectionTime_s(validSetpoint) = V_H2_std_m3(validSetpoint) ./ MFC_setpoint_std_m3_s(validSetpoint);
injectionTime_min(validSetpoint) = injectionTime_s(validSetpoint) / 60;

resultHeaders = { ...
    'V_chamber_L', ...
    'T_chamber_K', ...
    'P_chamber_Pa', ...
    'H2_volPct', ...
    'm_H2_injected_g', ...
    'V_H2_injected_L', ...
    'V_H2_std_L', ...
    'MFC_setpoint_SLPM', ...
    'InjectionTime_s', ...
    'InjectionTime_min'};

resultMatrix = [ ...
    V_chamber_L(:), ...
    T_chamber_K(:), ...
    P_chamber_Pa(:), ...
    H2_volPct(:), ...
    m_H2_injected_g(:), ...
    V_H2_injected_L(:), ...
    V_H2_std_L(:), ...
    MFC_setpoint_SLPM(:), ...
    injectionTime_s(:), ...
    injectionTime_min(:)];

Results = struct();
Results.inputs = struct( ...
    'V_chamber_m3', V_chamber_m3, ...
    'T_chamber_K', T_chamber_K, ...
    'P_chamber_Pa', P_chamber_Pa, ...
    'H2_volPct', H2_volPct, ...
    'T_std_K', T_std_K, ...
    'P_std_Pa', P_std_Pa, ...
    'MFC_setpoint_SLPM', MFC_setpoint_SLPM, ...
    'makePlot', makePlot, ...
    'Ru', Ru, ...
    'M_H2', M_H2);
Results.headers = resultHeaders;
Results.data = resultMatrix;
Results.V_chamber_m3 = V_chamber_m3(:);
Results.V_chamber_L = V_chamber_L(:);
Results.T_chamber_K = T_chamber_K(:);
Results.P_chamber_Pa = P_chamber_Pa(:);
Results.H2_volPct = H2_volPct(:);
Results.H2_fraction = x_H2(:);
Results.n_H2_mol = n_H2_mol(:);
Results.m_H2_kg = m_H2_kg(:);
Results.m_H2_injected_g = m_H2_injected_g(:);
Results.V_H2_injected_m3 = V_H2_injected_m3(:);
Results.V_H2_std_m3 = V_H2_std_m3(:);
Results.V_H2_injected_L = V_H2_injected_L(:);
Results.V_H2_std_L = V_H2_std_L(:);
Results.MFC_setpoint_SLPM = MFC_setpoint_SLPM(:);
Results.InjectionTime_s = injectionTime_s(:);
Results.InjectionTime_min = injectionTime_min(:);
Results.FillTime_s = injectionTime_s(:);
Results.FillTime_min = injectionTime_min(:);

if exist('table', 'builtin') || exist('table', 'file')
    Results.table = table( ...
        Results.V_chamber_L, ...
        Results.T_chamber_K, ...
        Results.P_chamber_Pa, ...
        Results.H2_volPct, ...
        Results.m_H2_injected_g, ...
        Results.V_H2_injected_L, ...
        Results.V_H2_std_L, ...
        Results.MFC_setpoint_SLPM, ...
        Results.InjectionTime_s, ...
        Results.InjectionTime_min, ...
        'VariableNames', resultHeaders);
end

if makePlot
    canPlot = true;
    if exist('available_graphics_toolkits', 'builtin') || exist('available_graphics_toolkits', 'file')
        canPlot = ~isempty(available_graphics_toolkits());
    end

    if canPlot
        figure('Color', 'w');
        plot(H2_volPct, m_H2_injected_g, 'o-', 'LineWidth', 1.5, 'MarkerSize', 7);
        grid on
        xlabel('Hydrogen concentration [vol%]')
        ylabel('Injected hydrogen mass [g]')
        title('Required H2 Mass for Vented Filling')
    end
end

end

function values = i_expandToCases(values, nCases, varName)
values = values(:);
assert(isnumeric(values), '%s must be numeric.', varName);

if isscalar(values)
    values = repmat(values, nCases, 1);
elseif numel(values) ~= nCases
    error('%s must be a scalar or have the same length as H2_volPct.', varName);
end
end
