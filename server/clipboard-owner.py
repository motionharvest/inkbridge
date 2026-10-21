"""Own the X11 clipboard with a page's SVG source.

Reads SVG source on stdin, takes the clipboard, prints "ready", and keeps
serving until another program takes the clipboard.

The clipboard offers the same source under two kinds of type:

  image/svg+xml   for apps that paste SVG images
  text types      for editors, terminals, and prompts, which paste the code

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

data = sys.stdin.buffer.read()
clipboard = Gdk.Atom.intern("CLIPBOARD", False)
svg = Gdk.Atom.intern("image/svg+xml", False)

owner = Gtk.Invisible()
owner.realize()
Gtk.selection_add_target(owner, clipboard, svg, IMAGE)
for name in TEXT_TARGETS:
    Gtk.selection_add_target(owner, clipboard, Gdk.Atom.intern(name, False), TEXT)


def on_selection_get(_widget, selection_data, info, _time):
    if info == IMAGE:
        selection_data.set(svg, 8, data)
    else:
        selection_data.set_text(data.decode("utf-8"), -1)


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
