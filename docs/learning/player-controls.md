# Player controls refresh

Implemented on 14 October 2026. This refresh improves the play icon's visual alignment and gives the custom player a quieter white/charcoal control palette, consistent SVG shapes, thin sliders and a compact quality selector.

## Why the play icon looked off-centre

An SVG's outer box can be centred while its drawing looks displaced. The previous play triangle started at x=9 and extended to x=20 inside a 24-unit box. The large button then added `margin-left: 3px`, pushing that already displaced drawing farther right.

The new player icon uses a rounded filled triangle with its visual weight near the centre of the same 24-unit coordinate system. The button centres the SVG through CSS grid and adds no horizontal offset. Both the large overlay and the control-row play button use this one drawing, so they stay consistent when their sizes change.

`viewBox="0 0 24 24"` describes drawing coordinates, not fixed screen pixels. CSS can display that drawing at 20, 22 or 28 pixels while preserving its proportions. Filled play/pause shapes remain readable at small sizes; volume and fullscreen use the same 1.65-unit stroke with round caps and joins.

## Component responsibilities

- [Player icons](../../apps/web/components/player-icon.tsx) own the SVG geometry. Decorative SVGs are hidden from assistive technology; their enclosing buttons keep the useful accessible names.
- [VideoPlayer](../../apps/web/components/video-player.tsx) connects buttons and sliders to the actual HTML video element. React state follows media events for playback, time, volume, muting and buffering. The volume glyph now also reflects quieter audio with one sound wave.
- [Player styles](../../apps/web/app/globals.css) define the frame, gradient, spacing, icon sizes and control states under the existing player selectors. Local white/slate variables keep the overlay readable across page themes.

The quality selector remains a native `select`, with a small decorative chevron. That preserves its keyboard navigation and platform selection behavior while letting the closed control fit the new styling. Existing labels such as Play, Pause, Seek video, Volume and Video quality remain available to screen readers and keyboard users.

## Thin tracks with usable interaction areas

The seek line is three pixels tall, but its input occupies a twenty-pixel interaction area. The volume line is two pixels tall within the same input height. Visual thickness and clickable area serve different purposes: the former makes the controls quiet, while the latter helps viewers use them.

Buttons provide explicit hover, pressed and keyboard-focus states. Slider focus is shown around the thumb instead of drawing a bright rectangle around the entire track. The player honours reduced-motion preferences for control transitions.

## Where the buffered indicator comes from

The seek track uses three real measurements:

```text
played percentage   = currentTime / duration × 100
buffered percentage = end of buffered range containing currentTime / duration × 100
volume percentage   = effective volume × 100
```

`video.buffered` returns `TimeRanges`: intervals the browser has actually buffered. The component captures that snapshot, finds the interval containing the playhead and updates on media time/progress events. White shows played media, a softer white shows buffered media, and a dim track shows the remainder. A paused or unbuffered video does not receive invented progress.

The effective volume is zero while muted. Changing the volume slider updates `video.volume` and clears mute; the normal `volumechange` event updates the icon and track.

## Verification and running result

Formatting, TypeScript and the production static export passed. Three existing production-browser scenarios passed against real isolated services/media:

1. HTTP playback, seek and quality selection with no tracker requests.
2. Custom play/pause, keyboard seek, mute/unmute, volume, fullscreen and mobile seek.
3. Actual adaptive upload, private preview, publication, 720p/480p selection and access revocation.

The normal web image was rebuilt and refreshed independently. The existing published user video played with the updated controls. Visual checks at the default desktop size, 390 pixels and 320 pixels confirmed the player layout. At 320 pixels, play, mute, quality and fullscreen all remained inside the frame. The viewport override was reset afterward.

Local before/after screenshots are saved under ignored `.local/screenshots/player-*.png`. They show the running app and are not generated design mockups. This refresh does not claim a new cross-network peer exercise or a full browser compatibility sweep.
