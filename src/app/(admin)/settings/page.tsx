import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";
import { getPublicSettings } from "@/lib/settings";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Only the public projection crosses to the client — the stored SMTP password
  // is never serialized, only a boolean saying whether one exists.
  const settings = await getPublicSettings();
  const locale = await getLocale();
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">{translate(locale, "nav.settings")}</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
