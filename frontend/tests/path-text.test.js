import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PathText from '../src/components/PathText';

describe('PathText', () => {
  it('allows line breaks only after separators', () => {
    const html = renderToStaticMarkup(React.createElement(PathText, { path: 'Raw_Data/VH2D-Demo-G01-01/DAQ-1/file.tpc5' }));
    expect(html).toContain('<span class="whitespace-nowrap">VH2D-Demo-G01-01/</span><wbr/>');
    expect(html.replace(/<[^>]+>/g, '')).toBe('Raw_Data/VH2D-Demo-G01-01/DAQ-1/file.tpc5');
    expect(html).toContain('title="Raw_Data/VH2D-Demo-G01-01/DAQ-1/file.tpc5"');
  });

  it('handles Windows paths', () => {
    const html = renderToStaticMarkup(React.createElement(PathText, { path: 'C:\\EXDA\\EXDA-Projects' }));
    expect(html).toContain('<span class="whitespace-nowrap">EXDA\\</span><wbr/>');
  });
});
