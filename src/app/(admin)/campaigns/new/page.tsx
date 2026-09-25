import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";
import NewCampaignForm from "./NewCampaignForm";

export default async function NewCampaignPage() {
  const locale = await getLocale();
  return (
    <div className="mx-auto grid max-w-lg gap-5">
      <h1 className="text-xl font-semibold">{translate(locale, "campaignNew.title")}</h1>
      <NewCampaignForm />
    </div>
  );
}
