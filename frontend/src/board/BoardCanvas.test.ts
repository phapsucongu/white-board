import { describe, expect, it } from 'vitest';
import { getViewportAfterStageDragEnd } from './BoardCanvas';

describe('BoardCanvas viewport drag handling', () => {
  it('does not pan the stage when a child object drag event bubbles', () => {
    const viewport = {
      x: 12,
      y: 24,
      scale: 1.5
    };

    expect(
      getViewportAfterStageDragEnd(viewport, false, {
        x: 200,
        y: 300
      })
    ).toBe(viewport);
  });

  it('updates viewport position when the stage itself is dragged', () => {
    expect(
      getViewportAfterStageDragEnd(
        {
          x: 12,
          y: 24,
          scale: 1.5
        },
        true,
        {
          x: 40,
          y: 56
        }
      )
    ).toEqual({
      x: 40,
      y: 56,
      scale: 1.5
    });
  });
});
