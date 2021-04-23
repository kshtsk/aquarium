# project aquarium's backend
# Copyright (C) 2021 SUSE, LLC.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

from logging import Logger
import time
from typing import (
    Awaitable,
    Callable,
    List,
    Optional
)
from fastapi.logger import logger as fastapi_logger
from pydantic.main import BaseModel
from gravel.cephadm.models import NodeInfoModel
from gravel.controllers.gstate import Ticker
from gravel.cephadm.cephadm import Cephadm


logger: Logger = fastapi_logger


class Subscriber(BaseModel):
    cb: Callable[[NodeInfoModel], Awaitable[None]]
    once: bool


class Inventory(Ticker):

    _latest: Optional[NodeInfoModel]
    _subscribers: List[Subscriber]

    def __init__(self, probe_interval: float):
        super().__init__(probe_interval)
        self._latest = None
        self._subscribers = []

    async def _do_tick(self) -> None:
        await self.probe()

    async def _should_tick(self) -> bool:
        return True

    async def probe(self) -> None:
        cephadm: Cephadm = Cephadm()
        start: int = int(time.monotonic())
        nodeinfo = await cephadm.get_node_info()
        diff: int = int(time.monotonic()) - start
        logger.info(f"probing took {diff} seconds")
        self._latest = nodeinfo
        await self._publish()

    @property
    def latest(self) -> Optional[NodeInfoModel]:
        return self._latest

    def subscribe(
        self,
        cb: Callable[[NodeInfoModel], Awaitable[None]],
        once: bool
    ) -> None:
        self._subscribers.append(Subscriber(cb=cb, once=once))

    async def _publish(self) -> None:
        assert self._latest
        for subscriber in self._subscribers:
            # ignore type because mypy is somehow broken when doing callbacks
            # see https://github.com/python/mypy/issues/5485
            await subscriber.cb(self._latest)  # type: ignore
            if subscriber.once:
                self._subscribers.remove(subscriber)
