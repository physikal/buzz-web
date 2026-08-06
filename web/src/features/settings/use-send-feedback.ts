import { useCallback, useRef, useState } from "react";

import { uploadMedia } from "@/features/channels/channel-api";
import {
  collectFeedbackDiagnostics,
  type ProductFeedbackInput,
  submitProductFeedback,
  type ProductFeedbackAttachment,
} from "./feedback-api";

export function useSendFeedback() {
  const [attachedImage, setAttachedImage] =
    useState<ProductFeedbackAttachment | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const sessionRef = useRef(0);
  const attachmentAttemptRef = useRef(0);

  const attachImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      throw new Error("Choose an image file.");
    }
    const session = sessionRef.current;
    const attempt = attachmentAttemptRef.current + 1;
    attachmentAttemptRef.current = attempt;
    setIsAttaching(true);
    try {
      const media = await uploadMedia(file);
      if (
        sessionRef.current !== session ||
        attachmentAttemptRef.current !== attempt
      ) {
        return;
      }
      setAttachedImage({ filename: file.name, media });
    } finally {
      if (
        sessionRef.current === session &&
        attachmentAttemptRef.current === attempt
      ) {
        setIsAttaching(false);
      }
    }
  }, []);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    attachmentAttemptRef.current += 1;
    setAttachedImage(null);
    setIsAttaching(false);
    setIsPending(false);
  }, []);

  const submit = useCallback(
    async (input: ProductFeedbackInput & { includeDiagnostics: boolean }) => {
      if (isPending) return;
      setIsPending(true);
      try {
        const attachments = attachedImage ? [attachedImage] : [];
        if (input.includeDiagnostics) {
          const diagnostics = await collectFeedbackDiagnostics();
          const filename = `feedback-diagnostics-${Date.now()}.txt`;
          const media = await uploadMedia(
            new File([diagnostics], filename, { type: "text/plain" }),
          );
          attachments.push({ filename, media });
        }
        await submitProductFeedback(input, attachments);
        reset();
      } finally {
        setIsPending(false);
      }
    },
    [attachedImage, isPending, reset],
  );

  return {
    attachImage,
    attachedImage,
    isAttaching,
    isPending,
    removeImage: () => setAttachedImage(null),
    reset,
    submit,
  };
}
