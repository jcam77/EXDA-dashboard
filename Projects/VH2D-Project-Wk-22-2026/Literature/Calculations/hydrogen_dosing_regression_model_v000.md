# Hydrogen Dosing Regression Model

## Objective

The objective is to estimate the required injected hydrogen mass as a function of:

- target hydrogen concentration
- chamber temperature
- experimentally observed deviations between ideal and measured concentration

The available experimental variables are:

- injected hydrogen mass, $m_{H_2}$ [g]
- chamber temperature, $T_C$ [°C]
- measured hydrogen concentration, $C_{H_2,\mathrm{meas}}$ [%vol]

Atmospheric pressure is assumed.

---

## Recommended Model

Use a **forward calibration model** based on the ideal-gas prediction, then invert it for dosing.

$$
C_{H_2,\mathrm{meas}} = \alpha + \beta C_{H_2,\mathrm{ideal}} + \varepsilon
$$

where:

$$
C_{H_2,\mathrm{ideal}}
=
100\frac{m_{H_2}RT_K}{M_{H_2}P_{\mathrm{atm}}V}
$$

and:

$$
T_K = T_C + 273.15
$$

After fitting $\alpha$ and $\beta$ from experimental data, the equation is inverted to calculate the required injected hydrogen mass.

$$
m_{H_2,\mathrm{required}}
=
\frac{C_{H_2,\mathrm{target}}-\alpha}{\beta}
\frac{M_{H_2}P_{\mathrm{atm}}V}{100RT_K}
$$

---

## Constants

Use:

$$
P_{\mathrm{atm}} = 101325 \ \mathrm{Pa}
$$

$$
M_{H_2} = 2.01588 \ \mathrm{g/mol}
$$

$$
R = 8.314462618 \ \mathrm{J/(mol\,K)}
$$

$$
T_K = T_C + 273.15
$$

where $V$ is the effective chamber volume in $\mathrm{m^3}$.

---

## Final Practical Equation

$$
m_{H_2,\mathrm{required}}
=
\frac{C_{H_2,\mathrm{target}}-\alpha}{\beta}
\frac{M_{H_2}P_{\mathrm{atm}}V}{100R(T_C+273.15)}
$$

This equation gives the required hydrogen mass in grams for a given target concentration and chamber temperature.

---

## Physics Argument

Hydrogen concentration in percent volume is approximately a mole fraction:

$$
x_{H_2}=\frac{n_{H_2}}{n_{\mathrm{total}}}
$$

The injected hydrogen moles are:

$$
n_{H_2}=\frac{m_{H_2}}{M_{H_2}}
$$

The total amount of gas inside the chamber, assuming atmospheric pressure, is given by the ideal gas law:

$$
PV=nRT
$$

Therefore:

$$
n_{\mathrm{total}}=\frac{P_{\mathrm{atm}}V}{RT_K}
$$

Substituting into the mole-fraction expression:

$$
x_{H_2}
=
\frac{m_{H_2}/M_{H_2}}{P_{\mathrm{atm}}V/(RT_K)}
$$

which simplifies to:

$$
x_{H_2}
=
\frac{m_{H_2}RT_K}{M_{H_2}P_{\mathrm{atm}}V}
$$

In percent volume:

$$
C_{H_2}[\%]
=
100\frac{m_{H_2}RT_K}{M_{H_2}P_{\mathrm{atm}}V}
$$

Therefore, the required hydrogen mass scales as:

$$
m_{H_2}\propto \frac{C_{H_2,\mathrm{target}}}{T_K}
$$

For the same target concentration, a warmer chamber requires slightly less hydrogen mass because, at the same pressure and volume, the chamber contains fewer total moles of gas.

---

## Why This Model Is Preferred

A purely empirical model such as:

$$
m = a + bC + cT
$$

is not recommended as the primary model because temperature does not act as an independent additive correction. Temperature enters through the ideal-gas law.

The preferred model is:

$$
C_{H_2,\mathrm{meas}} = \alpha + \beta C_{H_2,\mathrm{ideal}}
$$

because it keeps the correct physical structure and uses regression only to correct real experimental deviations.

---

## Interpretation of Regression Coefficients

### Intercept: $\alpha$

The intercept accounts for offset effects such as:

- residual hydrogen in the chamber
- analyser zero offset
- imperfect purging
- baseline error

### Slope: $\beta$

The slope accounts for proportional deviations such as:

- MFC dosing error
- effective chamber volume error
- hydrogen loss during injection
- gas analyser calibration slope error
- small errors caused by the atmospheric pressure assumption

---

## Recommended Workflow

### Step 1: Compute ideal concentration for each experiment

For each experiment, compute:

$$
C_{H_2,\mathrm{ideal},i}
=
100\frac{m_{H_2,i}RT_{K,i}}{M_{H_2}P_{\mathrm{atm}}V}
$$

### Step 2: Fit the regression

Fit:

$$
C_{H_2,\mathrm{meas},i}
=
\alpha
+
\beta C_{H_2,\mathrm{ideal},i}
+
\varepsilon_i
$$

### Step 3: Inspect residuals

Inspect residuals versus:

- target concentration
- chamber temperature
- test order
- injection mass

This helps identify whether the deviation is random scatter or a systematic experimental effect.

### Step 4: Use the inverted model for future dosing

Use:

$$
m_{H_2,\mathrm{required}}
=
\frac{C_{H_2,\mathrm{target}}-\alpha}{\beta}
\frac{M_{H_2}P_{\mathrm{atm}}V}{100R(T_C+273.15)}
$$

---

## Key Assumption

Atmospheric pressure is assumed:

$$
P = P_{\mathrm{atm}} = 101325 \ \mathrm{Pa}
$$

This is acceptable if the chamber is vented or equilibrated to ambient pressure before the concentration measurement.

If chamber pressure is later measured, the model can be upgraded by replacing $P_{\mathrm{atm}}$ with the measured absolute pressure $P_i$.
