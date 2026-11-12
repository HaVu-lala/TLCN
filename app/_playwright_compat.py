"""Tương thích Playwright sync trên Windows khi chạy dưới uvicorn.

uvicorn (uvicorn/loops/asyncio.py) ép WindowsSelectorEventLoopPolicy trên Windows.
SelectorEventLoop KHÔNG hỗ trợ subprocess (asyncio.base_events.subprocess_exec ->
NotImplementedError), nên Playwright sync không khởi động được trình duyệt khi oracle
XSS chạy trong tiến trình server -> lỗi bị nuốt và detector trả rỗng (mất phát hiện).

Context manager này tạm đổi policy sang ProactorEventLoop quanh lúc dùng Playwright,
rồi khôi phục. An toàn với vòng lặp đang chạy của uvicorn (chỉ ảnh hưởng vòng lặp mới
mà Playwright tạo cho driver của nó). Không làm gì trên nền tảng khác Windows.
"""
import asyncio
import contextlib
import sys


@contextlib.contextmanager
def playwright_event_loop_policy():
    if sys.platform.startswith("win"):
        previous = asyncio.get_event_loop_policy()
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        try:
            yield
        finally:
            asyncio.set_event_loop_policy(previous)
    else:
        yield
