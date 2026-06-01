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

## Simplified Direct Dosing Model

A simplified alternative is to regress the injected mass directly against the temperature-corrected measured concentration:

$$
m_{H_2}
=
a
+
b
\left(
\frac{C_{H_2,\mathrm{meas}}}{T_K}
\right)
$$

For future dosing, the measured concentration is replaced by the target concentration:

$$
m_{H_2,\mathrm{required}}
=
a
+
b
\left(
\frac{C_{H_2,\mathrm{target}}}{T_K}
\right)
$$

This model is physically motivated because, for fixed chamber volume and atmospheric pressure, the ideal-gas relation gives:

$$
m_{H_2}
\propto
\frac{C_{H_2}}{T_K}
$$

Therefore, the predictor $C_{H_2}/T_K$ has the correct first-order physical structure.

### When the Simplified Model Is Acceptable

The simplified model can be useful as a practical interpolation tool when:

- the temperature range is narrow
- the analyser zero offset is negligible
- residual hydrogen before injection is negligible
- the data are only used within the tested concentration range
- the purpose is operational dosing rather than physical interpretation

### Inherent Limitations of the Simplified Model

The simplified model is not the preferred primary model because it is an inverse empirical regression. It directly predicts the required injected mass, but the actual measured response in the experiment is the achieved concentration.

The main limitations are:

1. **The regression error is placed on injected mass instead of concentration.**

   In the experiment, the quantity being observed with most uncertainty is usually the achieved concentration, not the dosing equation itself. The forward model places the residual error on $C_{H_2,\mathrm{meas}}$, which is more consistent with the measurement process.

2. **The intercept $a$ is not physically exact if the true offset is in concentration.**

   If the real system has a concentration offset $\alpha$, the inverted forward model gives:

   $$
   m_{H_2,\mathrm{required}}
   =
   \frac{C_{H_2,\mathrm{target}}-\alpha}{\beta}
   \frac{M_{H_2}P_{\mathrm{atm}}V}{100RT_K}
   $$

   This can be rearranged as:

   $$
   m_{H_2,\mathrm{required}}
   =
   A\frac{C_{H_2,\mathrm{target}}}{T_K}
   -
   A\frac{\alpha}{T_K}
   $$

   Therefore, the offset term depends on $1/T_K$. The simplified model instead uses a constant intercept $a$, which is only approximately valid over a narrow temperature range.

3. **It does not clearly separate offset and proportional effects.**

   The simplified model cannot clearly distinguish between:

   - analyser zero offset
   - residual hydrogen
   - imperfect purging
   - MFC dosing slope error
   - effective chamber volume error
   - analyser calibration slope error

   The forward model separates these more cleanly through $\alpha$ and $\beta$.

4. **It is mainly valid for interpolation.**

   The simplified model should not be extrapolated outside the tested range of concentration, temperature, or injection mass.

5. **It can hide systematic residual trends.**

   A good fit in terms of $R^2$ does not guarantee that the model is physically adequate. Residuals should still be checked versus temperature, target concentration, test order, and injected mass.

### Practical Recommendation

Use the simplified model only as a secondary operational model or quick dosing approximation.

Use the forward calibration model as the primary model:

$$
C_{H_2,\mathrm{meas}}
=
\alpha
+
\beta C_{H_2,\mathrm{ideal}}
+
\varepsilon
$$

then invert it for dosing.

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

## Why the Forward Model Is Preferred

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
