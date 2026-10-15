# Inkbridge

Inkbridge is a sketchpad that runs in the browser on an iPad and on a computer at the same time. Both devices show the same page, and ink appears on the other device while you draw it. Copy on any device puts the page on the computer's clipboard as a PNG image, ready to paste into a prompt.

The project exists to make one path fast: sketch on the iPad with the Pencil, then paste that sketch on the computer.

## What it does

A space holds your notebooks. Each space has a six-digit code, and every device that enters the code sees the same notebooks.

Pressing and holding a notebook cover in the notebook list starts editing. Each cover then shows a minus button. A tap on a minus button asks for confirmation, then removes the notebook and every page in it. Done, `Esc`, or a tap on a cover ends editing. The pencil next to a notebook's name renames it.

A notebook holds pages. Swipe a finger from right to left to go to the next page. Swipe from left to right to go back.

A tap on the page number in the bottom left corner opens the page grid, a preview of every page in the notebook. A tap on a preview opens that page. Pressing and holding a preview starts editing: each page shows a minus button in its top left corner, and the pages after a removed page move over to close the gap. Done, `Esc`, or a tap on a preview ends editing. A notebook always keeps at least one page. The other devices open and close the page grid along with you.

On the last page, a swipe to the left pulls against resistance, and a New page indicator slides in from the right edge. Its ring fills as the finger travels. When the ring closes, the indicator fills with color. Lifting the finger then adds a new page with the same paper as the page before it. Lifting the finger before the ring closes springs the page back and adds nothing.

Each page has paper, ink, and a fixed size of 1600 by 1120 units. The default paper is a very dark, desaturated purple (`#231f29`) with a light-medium gray dot grid (`#9b99a1`). The Paper menu offers three other papers, and the paper you choose last becomes the paper for new notebooks.

The toolbar keeps the drawing controls at its right edge, where a right hand reaches them. From left to right they are the color slots, a plus button, three size slots, the Pen, the Eraser, and the Select tool. The page number and the previous and next page arrows sit in the bottom left corner of the page area.

A slot holds one value and keeps it, so the toolbar becomes your own palette. A tap on a slot selects it.

The size slots belong to the selected tool. The Pen has three line widths and the Eraser has three circle sizes, and each tool remembers its own. Each size slot previews its size: a short horizontal line at the line width for the Pen, and the eraser circle, a dark fill with a light gray outline, for the Eraser. A tap on the selected size slot opens a slider with five tick marks that changes that slot's size.

The color slots show while the Pen is selected. The selected color slot shows a chevron, and a tap on it opens the color picker and saves the new color to that slot. The plus button adds a color slot, up to twelve.

The Eraser removes only the ink inside a small circle. A ring shows the circle at the pointer while the Eraser is on. A pass through the middle of a line splits it into two lines, and the rest of the line stays.

Undo reverses this device's last step on the current page. A step is one drawn line or one eraser pass, so Undo after an eraser pass restores every line that pass cut.

Every device follows the others, in both directions. The space is always on one view: the notebook list, one page, or a notebook's page grid. When any device opens a page, goes back to the notebook list, or creates a notebook and enters it, every other device does the same. A device that joins or reconnects starts on the view the space is on. The computer therefore shows what you see on the iPad without any input.

The Select tool, a dashed square, drags a light blue rectangle over the page. While a selection exists, Copy copies only the selected region, at twice page resolution so a small region still pastes as a usable image. A tap without a drag, `Esc`, a page change, or another tool clears the selection. The selection belongs to the device that made it and does not sync.

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
| One finger, swipe right to left | Next page; on the last page, a full pull adds a page |
| One finger, swipe left to right | Previous page |
| Two fingers, double tap | Undo once |
| Two fingers, pinch | Zoom in or out, up to six times |
| One or two fingers on a zoomed page | Move the page |
| Ctrl with the scroll wheel, or a trackpad pinch | Zoom on a computer |
| `Ctrl+=`, `Ctrl+-`, `Ctrl+0` | Zoom in, zoom out, show the whole page |
| `→` or `Page Down` | Next page, or a new page at the end |
| `←` or `Page Up` | Previous page |
| `Ctrl+C` or `⌘C`, or the Copy button | Copy the page as a PNG to the computer's clipboard |
| `E` | Switch between the Pen and the Eraser |
| `S` | Switch between the Pen and the Select tool |
| `1`, `2`, `3` | Select a size slot |
| `[` and `]` | Make the selected size slot smaller or larger |
| `Ctrl+Z` or `⌘Z` | Undo |
| `Esc` | Clear the selection, or go back to the notebook list |

A finger never draws. This rule keeps a resting palm from leaving marks, and it frees fingers for swipes and zoom. Zoom belongs to each device and resets when the page changes. A touch within half a second of Pencil input is ignored for the same reason.

On the iPad, Safari's **Share → Add to Home Screen** opens Inkbridge full screen, without the browser's address bar.

## How Copy works

The server runs on the computer, so the server can reach the computer's clipboard. Copy renders the page as a 1600 by 1120 PNG on the device where you press it and sends the image to the server. The server puts the image on the computer's clipboard with `xclip` on Linux with X11, `wl-copy` on Linux with Wayland, `osascript` on macOS, or PowerShell on Windows. The computer needs no Inkbridge tab open for this.

The other devices in the space show a short notice that a page went to the computer's clipboard. A device whose browser allows clipboard writes, such as the computer's own browser on `localhost`, also copies the image to its own clipboard. When neither clipboard takes the image, the page downloads as a PNG file.

## How sync works

Every change is an op: a small JSON message such as "start a stroke", "add these points", or "add a page". The file `public/js/shared/ops.js` defines every op in one function, `applyOp`.

A device applies each op to its own copy of the space, then sends the op over Socket.IO. The server applies the same `applyOp` to its copy and relays the op to the other devices in the space. The browser and the server import the same file, so they cannot disagree about what an op means.

While you draw, new points appear on your screen immediately. They go to the server once per animation frame, so a fast Pencil sends about sixty messages per second, not one per sample.

The server keeps each space in memory and writes it to `data/<code>.json` shortly after each change. A device that joins or reconnects receives the whole space from the server.

```
public/
  index.html, style.css     the three screens: pair, notebook list, page
  js/app.js                 state, screens, Socket.IO wiring, copy
  js/board.js               the page view, zoom, Pencil and finger input, page slides
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

Copy reaches the clipboard of the one computer that runs the server. A second computer in the same space does not receive the image on its clipboard. The iPad's own clipboard does not receive it either, because the iPad loads the app over plain HTTP, and browsers allow clipboard writes only on secure pages.

The Linux clipboard path is verified with `xclip` on X11. The macOS, Windows, and Wayland paths are written but not yet run.

Verified on a Linux desktop in Brave: creating a space, creating a notebook, drawing with a mouse, adding a page with `→`, copying a page to the clipboard as a 1600 by 1120 PNG, cutting a gap in one line with the Eraser, restoring the line with Undo, adding and editing color slots, and zooming with `Ctrl+=` while drawing stays under the pointer. On the iPad, the user drew with the Pencil and saw the ink sync to the computer. Pinch zoom on the iPad is not yet tested on a device.

There is no redo, no page reordering, and no page deletion.
