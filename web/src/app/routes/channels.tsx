import { createFileRoute } from "@tanstack/react-router";

import { ChannelsPage } from "@/features/channels/ui/ChannelsPage";

export const Route = createFileRoute("/channels")({ component: ChannelsPage });
