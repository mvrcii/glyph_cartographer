"""Entry point for running glyph.download as a module."""
import asyncio


def main():
    """Main entry point for module execution."""
    try:
        from .fetch_tiles import main as fetch_main
    except ImportError:
        # Handle case where running from different context
        from tile_download.download.fetch_tiles import main as fetch_main

    asyncio.run(fetch_main())


if __name__ == "__main__":
    main()
