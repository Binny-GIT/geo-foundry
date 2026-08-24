import type { ServerProps } from "payload"

import { HeaderClient } from "./HeaderClient"

/**
 * Custom admin header — replaces Payload's stock AppHeader entirely
 * (registered via `admin.components.header`). Breadcrumbs and per-view
 * action buttons (Save/Publish/etc.) aren't computed here: Payload's own
 * List/Edit views already write breadcrumbs into the global StepNav
 * provider, and DefaultTemplate already resolves each view's actions into
 * the Actions provider before this component renders. HeaderClient just
 * reads both through their public hooks (`useStepNav`, `useActions`), so
 * replacing the header doesn't require reimplementing that logic — only
 * how it's presented.
 */
export const Header = (_props: ServerProps) => <HeaderClient />
