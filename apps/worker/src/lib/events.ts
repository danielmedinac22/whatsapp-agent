import { EventEmitter } from "node:events";
import type { WaEvent } from "@wa/shared";

class WaEvents extends EventEmitter {
  emitEvent(ev: WaEvent) {
    this.emit("event", ev);
  }
  onEvent(handler: (ev: WaEvent) => void) {
    this.on("event", handler);
    return () => this.off("event", handler);
  }
}

export const events = new WaEvents();
events.setMaxListeners(100);
