import {
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import { StyledQrCode } from "@/shared/ui/styled-qr-code";
import { MobilePairingController } from "../mobile-pairing";

type PairingStep =
  | "idle"
  | "generating"
  | "qr"
  | "expired"
  | "sas"
  | "transferring"
  | "done"
  | "error";

function pairingErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.toLowerCase().includes("timeout")) {
    return "Pairing took too long. Try again.";
  }
  return message || "We couldn't start pairing. Try again.";
}

function PairingStatusDialog({
  onClose,
  onConfirm,
  onDeny,
  sasCode,
  step,
}: {
  onClose: () => void;
  onConfirm: () => void;
  onDeny: () => void;
  sasCode: string | null;
  step: PairingStep;
}) {
  const open = step === "sas" || step === "transferring" || step === "done";
  useEscapeSurface(open, onClose, step === "transferring");
  if (!open) return null;
  return (
    <div
      aria-label="Pair mobile device"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      data-testid="mobile-pairing-dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && step !== "transferring") {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Pair mobile device</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "sas"
                ? "Verify the security code matches your mobile device."
                : step === "done"
                  ? "Your mobile device is now paired."
                  : "Securely sending your identity to the mobile app."}
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={step === "transferring"}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        {step === "sas" && sasCode ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <ShieldCheck className="h-10 w-10 text-primary" />
              <p className="text-center text-sm font-medium">
                Verify this code matches your mobile device
              </p>
              <div className="max-w-full rounded-lg border-2 border-primary/30 bg-primary/5 px-5 py-4 sm:px-8">
                <p
                  className="whitespace-nowrap font-mono text-3xl font-bold sm:text-4xl"
                  data-testid="pairing-sas-code"
                >
                  {sasCode.slice(0, 3)} {sasCode.slice(3)}
                </p>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                You are about to transfer your Buzz identity to another device.
                Only confirm if you initiated this pairing.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                data-testid="deny-sas"
                onClick={onDeny}
                variant="outline"
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
              <Button
                className="flex-1"
                data-testid="confirm-sas"
                onClick={onConfirm}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Codes match
              </Button>
            </div>
          </div>
        ) : step === "transferring" ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sending identity to mobile device...
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-3 py-12"
            data-testid="mobile-pairing-done"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-sm font-medium">Mobile device paired</p>
            <p className="text-center text-xs text-muted-foreground">
              Your mobile app is now connected to this relay.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function MobilePairingPanel() {
  const [step, setStep] = useState<PairingStep>("idle");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [sasCode, setSasCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<MobilePairingController | null>(null);
  const requestIdRef = useRef(0);

  const beginPairing = useCallback(() => {
    const requestId = ++requestIdRef.current;
    void controllerRef.current?.cancel();
    setStep("generating");
    setQrUri(null);
    setSasCode(null);
    setError(null);

    const current = () => requestId === requestIdRef.current;
    const controller = new MobilePairingController({
      onSas: (sas) => {
        if (!current()) return;
        setSasCode(sas);
        setStep("sas");
      },
      onComplete: () => {
        if (current()) setStep("done");
      },
      onAborted: (reason) => {
        if (!current()) return;
        setError(`Pairing stopped: ${reason}`);
        setStep("error");
      },
      onError: (cause) => {
        if (!current()) return;
        setError(pairingErrorMessage(cause));
        setStep("error");
      },
      onExpired: () => {
        if (!current()) return;
        setQrUri(null);
        setSasCode(null);
        setError(null);
        setStep("expired");
      },
    });
    controllerRef.current = controller;
    void controller.start().then(
      (uri) => {
        if (!current()) return;
        setQrUri(uri);
        setStep("qr");
      },
      (cause) => {
        if (!current()) return;
        setError(pairingErrorMessage(cause));
        setStep("error");
      },
    );
  }, []);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      void controllerRef.current?.cancel();
      controllerRef.current = null;
    },
    [],
  );

  async function copyPairingCode() {
    if (!qrUri) return;
    await navigator.clipboard.writeText(qrUri);
    toast.success("Copied to clipboard");
  }

  async function confirmSas() {
    setStep("transferring");
    try {
      await controllerRef.current?.confirm();
    } catch (cause) {
      setError(pairingErrorMessage(cause));
      setStep("error");
      await controllerRef.current?.cancel().catch(() => undefined);
    }
  }

  function denySas() {
    void controllerRef.current?.cancel("sas_mismatch");
    setError("The codes didn't match. Pairing was canceled.");
    setStep("error");
  }

  function closeDialog() {
    if (step === "done") {
      setStep("idle");
      setQrUri(null);
      setSasCode(null);
      setError(null);
      return;
    }
    void controllerRef.current?.cancel();
    setError("Pairing was canceled.");
    setStep("error");
  }

  return (
    <section className="min-w-0" data-testid="settings-mobile">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Mobile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the Buzz mobile app to this relay by scanning a QR code. The
          connection is secured with end-to-end encryption and a verification
          code.
        </p>
      </header>

      <div
        className="mx-auto w-fit max-w-full rounded-lg border bg-card"
        data-testid="mobile-pairing-card"
      >
        <div className="flex flex-col items-stretch gap-3 p-4">
          <div
            className="flex min-h-[266px] w-[266px] max-w-full shrink-0 items-center justify-center rounded-lg border bg-white p-3"
            data-testid="mobile-pairing-qr-container"
          >
            {step === "qr" && qrUri ? (
              <StyledQrCode
                animate
                centerImageSrc={buzzAppIcon}
                className="h-auto max-w-full"
                data-testid="mobile-pairing-qr"
                size={240}
                title="Mobile pairing QR code"
                value={qrUri}
              />
            ) : step === "expired" ? (
              <div className="flex max-w-52 flex-col items-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Pairing code expired.
                </p>
                <Button
                  data-testid="regenerate-pairing-button"
                  onClick={beginPairing}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Generate new pairing code
                </Button>
              </div>
            ) : step === "error" ? (
              <div className="flex max-w-52 flex-col items-center gap-3 text-center">
                <TriangleAlert className="h-6 w-6 text-destructive" />
                <p className="text-sm text-destructive">
                  {error ?? "Pairing session ended."}
                </p>
                <Button
                  data-testid="retry-pairing-button"
                  onClick={beginPairing}
                  size="sm"
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : step === "idle" ? (
              <Button data-testid="start-pairing-button" onClick={beginPairing}>
                Start pairing
              </Button>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <LoaderCircle
                  className="h-6 w-6 animate-spin text-muted-foreground"
                  data-testid="pairing-loading-spinner"
                />
                <p className="text-sm text-muted-foreground">
                  Starting pairing...
                </p>
              </div>
            )}
          </div>

          {step === "qr" && qrUri ? (
            <Button
              className="w-full"
              data-testid="copy-pairing-code"
              onClick={() => void copyPairingCode()}
              size="sm"
              variant="outline"
            >
              <Copy className="mr-1.5 h-4 w-4" />
              Copy pairing code
            </Button>
          ) : null}
        </div>
      </div>

      <PairingStatusDialog
        onClose={closeDialog}
        onConfirm={() => void confirmSas()}
        onDeny={denySas}
        sasCode={sasCode}
        step={step}
      />
    </section>
  );
}
