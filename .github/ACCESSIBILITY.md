# Accessibility

EXDA is used on test days, often on a laptop in a control room, and for long
sessions. It should be readable and usable for everyone in the team, including
people with low vision or colour-vision deficiency.

## What EXDA does

- **Contrast:** every text colour reaches at least 4.5:1 against its
  background, measured in both themes (see the table in the
  [design guide](../docs/EXDA-Design-Guide.md)).
- **Light and dark themes,** both complete; switch with the toggle in the top
  bar.
- **Text size:** at least 11 px everywhere, including chart labels; normal
  text is 12–14 px. The browser zoom (Ctrl/Cmd + `+`) works on every screen.
- **Colour is never the only signal:** statuses have words, warnings have an
  icon and text, chart categories have a legend.
- **Colour-blind-safe chart colours:** the plot and word-cloud palettes were
  checked with a colour-vision validator for colour-blind and normal vision.
- **Labels:** icon-only buttons have names for screen readers and a tooltip;
  the capabilities word cloud can be used with the keyboard.
- **Keyboard shortcuts:** press `?` in a project to see them.

## Supported environments

EXDA runs in a current version of Chrome, Edge, Firefox or Safari on Windows,
macOS or Linux. It is designed for laptop and desktop screens (about 1200 px
wide or more); phones and small tablets are not supported.

## Known limitations

- **Plots** (raw data screening) are drawn on a canvas, which screen readers
  cannot read. The numbers that matter (peak pressure and its time) are also
  in the Peak pressures table, which is plain text.
- **Screen readers** have not been tested systematically; some older screens
  may have form fields without a proper label.
- **Keyboard use:** most controls work with the keyboard, but some drag
  actions (moving a run in the Plan timeline, moving the run card) need a
  mouse; the same changes can be made by editing the run's date in its card.
- No formal accessibility audit (for example against WCAG 2.2) has been done.

## Report a barrier

If something in EXDA is hard to read, see or use, please open an
[accessibility issue](https://github.com/jcam77/EXDA-dashboard/issues/new?template=accessibility.yml)
(contact is only through GitHub). Tell us where it happens and, if you like,
your browser, screen size, zoom and any assistive technology. Barriers that
affect test-day work are fixed first.
