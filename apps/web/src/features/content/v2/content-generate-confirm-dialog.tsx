"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useWallet } from "@/features/billing/wallet-context";
import { cn } from "@/lib/utils";

export function ContentGenerateConfirmDialog({
  open,
  cost,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly cost: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  const t = useTranslations("ContentV2.studio");
  const { wallet, loading } = useWallet();
  const balance = wallet?.balance ?? null;
  const insufficient = !loading && balance !== null && balance < cost;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Popup
          className={cn(
            "fixed top-1/2 start-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ltr:-translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-5 shadow-elevated",
            "focus-visible:ring-3 focus-visible:ring-ring/40 md:p-6",
          )}
        >
          <Dialog.Title className="text-xl font-bold text-navy">
            {t("confirmTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {insufficient
              ? t("confirmInsufficient", {
                  points: cost,
                  balance: balance ?? 0,
                })
              : balance === null
                ? t("confirmBodyNoBalance", { points: cost })
                : t("confirmBody", { points: cost, balance })}
          </Dialog.Description>
          {insufficient ? (
            <p className="mt-4">
              <Link
                href="/billing"
                className="text-sm font-semibold text-primary transition-colors hover:text-primary/80 hover:underline"
              >
                {t("topUpCta")}
              </Link>
            </p>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close render={<Button type="button" variant="ghost" />}>
              {t("confirmCancel")}
            </Dialog.Close>
            <Button
              type="button"
              className="shadow-tactile"
              disabled={insufficient}
              onClick={onConfirm}
            >
              {t("confirmCta")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
