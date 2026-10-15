# Inkbridge

Inkbridge is a sketchpad that runs in the browser on an iPad and on a computer at the same time. Both devices show the same page, and ink appears on the other device while you draw it. On the computer, one keystroke copies the page as a PNG image, ready to paste into a prompt.

The project exists to make one path fast: sketch on the iPad with the Pencil, then paste that sketch on the computer.

## What it does

A space holds your notebooks. Each space has a six-digit code, and every device that enters the code sees the same notebooks.

A notebook holds pages. Swipe a finger from right to left to go to the next page. Swipe from left to right to go back. A swipe past the last page adds a new page with the same paper as the page before it.

Each page has paper, ink, and a fixed size of 1600 by 1120 units. The default paper is a very dark, desaturated purple (`#231f29`) with a light-medium gray dot grid (`#9b99a1`). The Paper menu offers three other papers, and the paper you choose last becomes the paper for new notebooks.

The toolbar has a Pen, an Eraser, one size button, ink colors, and Undo. The ink colors show only while the Pen is selected: eight presets and a custom color picker.

The size button previews the selected tool at its current size. For the Pen it shows a dot of ink. For the Eraser it shows the eraser circle: a dark fill with a light gray outline. Tap the size button, or tap the selected tool a second time, to open a slider under it. Each tool remembers its own size, so switching tools brings back the size you last used with that tool. On a keyboard, `[` and `]` make the size smaller and larger.

The Eraser removes only the ink inside a small circle. A ring shows the circle at the pointer while the Eraser is on. A pass through the middle of a line splits it into two lines, and the rest of the line stays.

Undo reverses this device's last step on the current page. A step is one drawn line or one eraser pass, so Undo after an eraser pass restores every line that pass cut.

Follow is on by default. When Follow is on, a device jumps to whichever page another device in the space opens. The computer therefore shows the page you are drawing on the iPad without any input.

## Run it

Inkbridge needs Node.js 20 or later.

```bash
npm install
npm start
```

The server prints two kinds of address. Open the `localhost` address on the computer. Open one of the "Other devices" addresses on the iPad. The iPad and the computer must be on the same network.

On the first device, choose **Start a new space**. The library shows the space code in its top right corner. On the second device, type that code and choose **Join**.

Each device remembers its space and rejoins it every time the app opens. The code is kept in the browser's local storage and in the address, as `?space=123456`. Add Inkbridge to the iPad Home Screen after joining, so the icon keeps that address and opens straight into the space. **Leave** in the notebook list is the only action that forgets the space.

To run the server with automatic restart on file changes, use `npm run dev`. To change the port, set `PORT`, for example `PORT=8080 npm start`.

## Input

| Input | Action |
| --- | --- |
| Apple Pencil or mouse | Draw |
| One finger, swipe right to left | Next page, or a new page at the end |
| One finger, swipe left to right | Previous page |
| `→` or `Page Down` | Next page, or a new page at the end |
| `←` or `Page Up` | Previous page |
| `Ctrl+C` or `⌘C`, or the Copy button | Copy the page as a PNG |
| `E` | Switch between the Pen and the Eraser |
| `[` and `]` | Make the current tool smaller or larger |
| `Ctrl+Z` or `⌘Z` | Undo |
| `Esc` | Back to the notebook list |

A finger never draws. This rule keeps a resting palm from leaving marks, and it frees the finger for swipes. A touch within half a second of Pencil input is ignored for the same reason.

On the iPad, Safari's **Share → Add to Home Screen** opens Inkbridge full screen, without the browser's address bar.

## How sync works

Every change is an op: a small JSON message such as "start a stroke", "add these points", or "add a page". The file `public/js/shared/ops.js` defines every op in one function, `applyOp`.

A device applies each op to its own copy of the space, then sends the op over Socket.IO. The server applies the same `applyOp` to its copy and relays the op to the other devices in the space. The browser and the server import the same file, so they cannot disagree about what an op means.

While you draw, new points appear on your screen immediately. They go to the server once per animation frame, so a fast Pencil sends about sixty messages per second, not one per sample.

The server keeps each space in memory and writes it to `data/<code>.json` shortly after each change. A device that joins or reconnects receives the whole space from the server.

```
public/
  index.html, style.css     the three screens: pair, notebook list, page
  js/app.js                 state, screens, Socket.IO wiring, copy
  js/board.js               canvas sizing, Pencil and finger input, page slides
  js/render.js              paper, ink, and PNG rendering
  js/erase.js               clips lines against the eraser circle
  js/shared/ops.js          the op definitions, shared with the server
server/
  index.js                  Express static files and Socket.IO rooms
  store.js                  in-memory spaces, saved to data/
test/                       op tests and a two-client sync test
```

## Tests

```bash
npm test
```

The tests cover each op and run two Socket.IO clients against a real server. The two clients create a space, join it, relay a notebook and a page view, and confirm that the space is saved to disk.

## Current limits

These statements describe version 0.1.0.

The server has no authentication. Anyone on the same network who knows a space code can open that space. Run it on a network you trust.

The iPad loads the app over plain HTTP from the computer's address. Browsers allow clipboard writes only on secure pages, so Copy on the iPad downloads a PNG file. Copy on the computer uses `localhost`, which browsers treat as secure, so it writes to the clipboard.

Verified on a Linux desktop in Brave: creating a space, creating a notebook, drawing with a mouse, adding a page with `→`, copying a page to the clipboard as a 1600 by 1120 PNG, cutting a gap in one line with the Eraser, and restoring the line with Undo. iPad behavior, including Pencil pressure and finger swipes, is not yet tested on a device.

There is no redo, no page reordering, and no page deletion.
