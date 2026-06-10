---
name: Tactical Precision
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#ffb783'
  on-secondary: '#4f2500'
  secondary-container: '#d97722'
  on-secondary-container: '#451f00'
  tertiary: '#4ee6aa'
  on-tertiary: '#003825'
  tertiary-container: '#22c990'
  on-tertiary-container: '#004e35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#ffdcc5'
  secondary-fixed-dim: '#ffb783'
  on-secondary-fixed: '#301400'
  on-secondary-fixed-variant: '#713700'
  tertiary-fixed: '#68fcbf'
  tertiary-fixed-dim: '#45dfa4'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
  canvas-bg: '#020617'
  panel-bg: rgba(30, 41, 59, 0.7)
  stroke-default: '#1f2937'
  fill-default: '#dbeafe'
  selection-overlay: rgba(56, 189, 248, 0.15)
  user-alpha: '#60a5fa'
  user-beta: '#f472b6'
  user-gamma: '#a78bfa'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-code:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 12px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 8px
  margin-compact: 12px
  panel-width: 280px
  toolbar-height: 48px
---

## Brand & Style

This design system is engineered for high-stakes, realtime collaboration where clarity and speed are paramount. The brand personality is **Tactical, Precise, and Modern**, evoking the feel of a mission control center or a high-end developer environment. It prioritizes information density and functional performance over decorative flair.

The visual style is a blend of **Minimalism** and **Glassmorphism**. We use a rigorous grid and sharp typography to maintain a professional "instrument" feel, while employing frosted glass effects for floating toolbars to ensure they remain legible against a complex, crowded canvas without completely obscuring the data beneath them. The aesthetic is "Dark Mode First," emphasizing a sophisticated, low-fatigue environment for long-duration technical sessions.

## Colors

The color palette is anchored in a **Slate/Zinc** dark scale to minimize eye strain and provide a "Tactical" foundation. The `canvas-bg` is the deepest shade, ensuring that graphical objects and user cursors provide maximum contrast.

- **Primary (Electric Blue):** Used for the current user's actions, primary tools, and active selection states.
- **Secondary & Tertiary (Orange/Green):** Reserved for secondary statuses or high-priority warnings/confirmations.
- **User Palette:** A dedicated set of high-chroma colors (`user-alpha`, etc.) is used to differentiate collaborators' cursors and "soft locks" on the canvas. 
- **The "Paper" Mode:** While the toolbars remain dark, the canvas can toggle to a light-gray (`#f8fafc`) for high-contrast documentation export, switching strokes to `#1f2937`.

## Typography

The system uses **Inter** for all functional UI elements to ensure maximum legibility at small sizes. **JetBrains Mono** is utilized for technical metadata, version IDs, and coordinate data to reinforce the "Tactical" and precise nature of the application.

- **Headlines:** Used sparingly for Room Names and Panel titles.
- **Labels:** Monospaced fonts are used for object IDs and "Server Version" tags in the history panel.
- **Canvas Text:** Text objects created by users default to Inter, but inherit a slightly tighter line-height to maintain compactness within shapes.

## Layout & Spacing

The layout philosophy follows a **Fixed-Fluid Hybrid**. The main canvas is a fluid, infinite-coordinate area, while the control interface consists of fixed-width sidebars and floating toolbars. 

To maximize the "tactical" workspace, we use a tight 4px base increment. 
- **Toolbars:** Centered at the bottom or top, utilizing floating glassmorphic containers.
- **Panels:** Right-aligned `ObjectDetailPanel` and left-aligned `MembersPanel` use fixed widths to prevent layout shift during realtime updates.
- **Safe Areas:** A 24px margin is maintained from the viewport edges for all floating elements to prevent interference with OS-level gestures.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Glassmorphism** rather than traditional shadows.

1.  **Canvas (Level 0):** The base layer where all drawings exist.
2.  **Grid Layer:** A faint, non-interactive visual guide.
3.  **Active Objects (Level 1):** Shapes being moved or edited, highlighted by a 2px primary-colored stroke.
4.  **Floating Toolbars (Level 2):** Use a `Backdrop Blur (12px)` and a semi-transparent `panel-bg` with a subtle 1px white border at 10% opacity.
5.  **Cursors & Presence (Level 3):** The highest layer, ensuring user pointers are always visible above content.

Shadows are used only for "Active" states of floating panels, utilizing a very tight, 4px blur with 40% opacity of the neutral color to give a subtle sense of detachment from the canvas.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a modern feel while maintaining the technical "sharpness" required for a tactical tool. 

- **UI Elements:** Buttons, inputs, and panel corners use the 4px (Soft) radius.
- **Canvas Objects:** Rectangles default to 0px (Sharp) corners to reflect their geometric accuracy, though users can toggle a "rounded" property.
- **Status Indicators:** Use pill-shapes (Full Radius) for presence indicators and status chips to distinguish them from functional tool buttons.

## Components

- **Buttons:** Tool buttons are square (40x40px) with a subtle hover state. Active tools use the `primary_color_hex` background with a white icon.
- **Floating Toolbars:** Glassmorphic containers with a thin internal divider between tool groups (Select, Shapes, Annotation).
- **Presence Cursors:** An SVG arrow tinted to the user's assigned color, accompanied by a small label tag showing the `displayName`.
- **Input Fields:** Minimalist design with a 1px border. On focus, the border transitions to the primary color with a subtle inner glow.
- **Cards (Object Details):** Use a condensed layout with `label-code` typography for key-value pairs (e.g., X: 120, Y: 450).
- **Transformer Handles:** 8x8px white squares with a 1px slate border, appearing only on selected canvas objects for resizing and rotation.
- **Status Chips:** Small, high-contrast badges used in the `HistoryPanel` to indicate `VERSION_CONFLICT` or `LOCKED` states.