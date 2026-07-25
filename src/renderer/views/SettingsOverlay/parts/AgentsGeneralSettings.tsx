import { useLingui } from "@lingui/react/macro";
import { ModelOrderSection } from "./ModelOrderSection";
import { ModelVisibilitySection } from "./ModelVisibilitySection";
import { ModelAliasesSection } from "./ModelAliasesSection";
import { SettingsPage } from "./SettingsForm";

export function AgentsGeneralSettings() {
  const { t } = useLingui();
  return (
    <SettingsPage title={t`Agents · General`}>
      <ModelVisibilitySection />
      <ModelOrderSection />
      <ModelAliasesSection />
    </SettingsPage>
  );
}
