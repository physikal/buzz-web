import { AppPrimarySidebar } from "@/features/navigation/AppPrimarySidebar";

export function ChannelsPrimarySidebar({
  open,
  ownerPubkey,
  onDisconnect,
}: {
  open: boolean;
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  if (!open) return null;
  return (
    <AppPrimarySidebar
      active="channels"
      onDisconnect={onDisconnect}
      ownerPubkey={ownerPubkey}
      visibleFrom="md"
    />
  );
}
