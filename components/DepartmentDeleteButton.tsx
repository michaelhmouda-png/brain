"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DepartmentDeleteButtonProps = {
  departmentId: string;
};

export default function DepartmentDeleteButton({ departmentId }: DepartmentDeleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!window.confirm("Delete this department? This action cannot be undone.")) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/departments/${departmentId}`, {
      method: "DELETE",
    });

    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || "Unable to delete department.");
      return;
    }

    router.refresh();
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="rounded-full bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
