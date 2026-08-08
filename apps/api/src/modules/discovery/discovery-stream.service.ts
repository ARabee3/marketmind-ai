import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { DiscoveryStreamEvent } from "@marketmind/contracts";

@Injectable()
export class DiscoveryStreamService {
  private readonly streams = new Map<string, Subject<MessageEvent>>();

  getStream(sessionId: string): Observable<MessageEvent> {
    let subject = this.streams.get(sessionId);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.streams.set(sessionId, subject);
    }
    return subject.asObservable();
  }

  emitEvent(sessionId: string, event: DiscoveryStreamEvent): void {
    const subject = this.streams.get(sessionId);
    if (subject) {
      subject.next({ data: event });
    }
  }

  removeStream(sessionId: string): void {
    const subject = this.streams.get(sessionId);
    if (subject) {
      subject.complete();
      this.streams.delete(sessionId);
    }
  }
}
