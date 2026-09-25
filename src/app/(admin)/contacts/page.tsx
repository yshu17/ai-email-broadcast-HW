import ContactsTable from "@/components/ContactsTable";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const locale = await getLocale();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold">{translate(locale, "nav.contacts")}</h1>
        <p className="hint mt-1">{translate(locale, "contacts.intro")}</p>
      </div>
      <ContactsTable />
    </div>
  );
}
