import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';

export const metadata = {
  title: 'Forgot Password — Brain',
  description: 'Reset your Brain account password',
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-[100dvh] bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
      <div className="safe-area-x safe-area-bottom safe-area-top relative flex min-h-[100dvh] items-center justify-center py-6">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
