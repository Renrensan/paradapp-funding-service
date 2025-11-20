import { injectable, inject } from "tsyringe";
import { interval, from, Subscription } from "rxjs";
import { exhaustMap } from "rxjs/operators";
import { ActionService } from "../action/action.service";

@injectable()
export class XenditResponsiveService {
  private subscription: Subscription | null = null;

  constructor(@inject(ActionService) private actionService: ActionService) {}

  start(intervalMs = 3000): Subscription {
    if (this.subscription && !this.subscription.closed) {
      return this.subscription;
    }

    this.subscription = interval(intervalMs)
      .pipe(
        exhaustMap(() => {
          return from(this.actionService.markPaidXenditDeposits());
        })
      )
      .subscribe({
        error: (err: any) =>
          console.error("❌ XenditResponsiveService error:", err),
      });

    return this.subscription;
  }

  stop() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
