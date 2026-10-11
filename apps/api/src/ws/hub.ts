// WebSocket hub placeholder defines the later transport boundary without opening a socket yet.
import type { WsEvent } from "../../../../packages/shared/src/ws.events.js";

export type WsSubscriber = (event: WsEvent) => void;

export class WebSocketHub {
  private readonly subscribers = new Set<WsSubscriber>();

  subscribe(subscriber: WsSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(event: WsEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

export const wsHub = new WebSocketHub();
