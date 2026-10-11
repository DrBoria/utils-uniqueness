// NOT duplicates — ground truth from the real run's duplicate-tier FPs.
// Both share a one-liner `Object.keys(...).<chain>` shape with the canonical
// enum utils, but perform a different operation.

enum PractitionerRole {
	PCP = "Primary Care Provider",
	NP = "Nurse Practitioner",
}

const CONTACT_TYPE_LABEL: Record<string, string> = {
	phone: "Phone",
	email: "Email",
};

// FP vs `enumKeys` (0.77 in the real run): finds the KEY whose VALUE matches —
// a lookup, not the key-listing that enumKeys does.
const teamKeyByValue = (val: PractitionerRole): string | undefined =>
	(Object.keys(PractitionerRole) as (keyof typeof PractitionerRole)[]).find((k) => PractitionerRole[k] === val);

// FP vs `enumValues` (0.76 in the real run): maps a contact's type codes to
// labels and joins them — not the enum's own values.
const joinLabels = (parts: (string | undefined)[]): string => parts.filter(Boolean).join(", ");

const contactTypes = (contact: { types: string[] }): string =>
	joinLabels(contact.types.map((t) => CONTACT_TYPE_LABEL[t]));

export { teamKeyByValue, contactTypes };
