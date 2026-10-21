"""Own the X11 clipboard with a page, as a PNG image or as SVG source.

Takes "png" or "svg" as its argument, reads the bytes on stdin, takes the
clipboard, prints "ready", and keeps serving until another program takes
the clipboard.

A PNG is offered as image/png, with an empty string under the text types.
The empty string matters for terminals. A terminal answers its paste key by
asking for text. If the clipboard has no text type at all, the terminal
sends nothing. If it has an empty text, the terminal sends an empty paste,
and terminal multiplexers such as herdr read that empty paste as the signal
to fetch the image instead. Screenshot tools behave the same way. xclip, by
contrast, answers a text request with the PNG bytes themselves, which
pastes binary noise.

SVG source is offered as image/svg+xml for apps that paste SVG images, and
as the text itself, so editors, terminals, and prompts paste the code.

GTK's selection API does the X11 protocol work, including INCR transfers for
data larger than one X request.
"""
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

IMAGE, TEXT = 1, 2
TEXT_TARGETS = ["UTF8_STRING", "text/plain;charset=utf-8", "text/plain", "STRING", "TEXT"]

kind = sys.argv[1] if len(sys.argv) > 1 else "png"
data = sys.stdin.buffer.read()
clipboard = Gdk.Atom.intern("CLIPBOARD", False)
image = Gdk.Atom.intern("image/svg+xml" if kind == "svg" else "image/png", False)
text = data.decode("utf-8") if kind == "svg" else ""

owner = Gtk.Invisible()
owner.realize()
Gtk.selection_add_target(owner, clipboard, image, IMAGE)
for name in TEXT_TARGETS:
    Gtk.selection_add_target(owner, clipboard, Gdk.Atom.intern(name, False), TEXT)


def on_selection_get(_widget, selection_data, info, _time):
    if info == IMAGE:
        selection_data.set(image, 8, data)
    else:
        selection_data.set_text(text, -1)


def on_selection_clear(*_args):
    # Another program took the clipboard, so there is nothing left to serve.
    Gtk.main_quit()
    return False


owner.connect("selection-get", on_selection_get)
owner.connect("selection-clear-event", on_selection_clear)

if not Gtk.selection_owner_set(owner, clipboard, Gdk.CURRENT_TIME):
    sys.exit("could not take the clipboard")


def announce():
    print("ready", flush=True)
    return False


GLib.idle_add(announce)
Gtk.main()
