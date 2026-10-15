"""Own the X11 clipboard with an image and nothing else.

xclip offers its data under every target an app asks for, so a terminal
that asks for text receives the PNG bytes as text. GTK's set_image offers
only image formats. An app that asks for text then gets nothing, and an app
that asks for an image gets the picture.

Reads a PNG on stdin, takes the clipboard, prints "ready", and keeps
serving until another program takes the clipboard.
"""
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk  # noqa: E402

data = sys.stdin.buffer.read()
loader = GdkPixbuf.PixbufLoader.new_with_type("png")
loader.write(data)
loader.close()
pixbuf = loader.get_pixbuf()

clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
ready = False


def on_owner_change(_clipboard, _event):
    # set_image makes GTK the owner of the clipboard's contents. When another
    # program takes the clipboard, GTK clears that owner, and this process
    # has nothing left to serve.
    if ready and clipboard.get_owner() is None:
        Gtk.main_quit()


clipboard.connect("owner-change", on_owner_change)
clipboard.set_image(pixbuf)


def announce():
    global ready
    ready = True
    print("ready", flush=True)
    return False


GLib.idle_add(announce)
Gtk.main()
