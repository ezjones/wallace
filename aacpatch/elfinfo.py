"""The three ELF questions aac-patch-tree asks, answered with pyelftools.

This replaces `readelf` so binutils is not a runtime requirement (pyelftools is
already vendored).  Output is deliberately shell-friendly.

    python -m aacpatch.elfinfo loadcount FILE
        Number of PT_LOAD segments.  Prints 0 for a file that is not an ELF,
        exactly as `readelf -lW FILE | grep -c LOAD` did.
    python -m aacpatch.elfinfo loads FILE
        One "<file_offset> <file_size>" line (decimal) per PT_LOAD segment.
    python -m aacpatch.elfinfo valid FILE
        Exit 0 if FILE has a parseable ELF header, 1 otherwise.
"""
import sys

from elftools.common.exceptions import ELFError
from elftools.elf.elffile import ELFFile


def _load_segments(path):
    """[(p_offset, p_filesz), ...] for every PT_LOAD; raises on a non-ELF."""
    with open(path, "rb") as f:
        elf = ELFFile(f)
        return [(s["p_offset"], s["p_filesz"])
                for s in elf.iter_segments() if s["p_type"] == "PT_LOAD"]


def main(argv):
    if len(argv) != 3 or argv[1] not in ("loadcount", "loads", "valid"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, path = argv[1], argv[2]
    try:
        segs = _load_segments(path)
    except (OSError, ELFError, ValueError, EOFError):
        if cmd == "loadcount":
            print(0)
            return 0
        return 1 if cmd == "valid" else 0
    if cmd == "loadcount":
        print(len(segs))
    elif cmd == "loads":
        for off, size in segs:
            print(off, size)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
