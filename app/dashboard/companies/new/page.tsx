import CompanyForm from "../../../../components/CompanyForm";

export default function NewCompanyPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <CompanyForm mode="create" />
    </div>
  );
}
