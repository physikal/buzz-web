import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import type { AgentRuntimeSecretField } from "../agent-api";
import { Input } from "@/shared/ui/input";

export function RuntimeCredentialFields({
  disabled,
  fields,
  replacement,
  values,
  onChange,
}: {
  disabled: boolean;
  fields: AgentRuntimeSecretField[];
  replacement?: boolean;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  return fields.map((field) => (
    <div className="space-y-1.5" key={field.env}>
      <p className="text-sm font-medium">
        {replacement ? `Replace ${field.label.toLowerCase()}` : field.label}
        {field.required && !replacement ? " *" : ""}
      </p>
      <div className="flex min-h-10 items-center rounded-md border bg-background px-3">
        <Input
          aria-label={field.label}
          autoComplete="off"
          className="h-8 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...values, [field.env]: event.target.value })
          }
          placeholder={
            replacement
              ? "Leave blank to keep the current value"
              : "Paste credential…"
          }
          type={shown[field.env] ? "text" : "password"}
          value={values[field.env] ?? ""}
        />
        <button
          aria-label={
            shown[field.env] ? `Hide ${field.label}` : `Show ${field.label}`
          }
          className="text-muted-foreground hover:text-foreground"
          disabled={disabled}
          onClick={() =>
            setShown((current) => ({
              ...current,
              [field.env]: !current[field.env],
            }))
          }
          type="button"
        >
          {shown[field.env] ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  ));
}
