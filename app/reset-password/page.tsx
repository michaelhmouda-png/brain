import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export const metadata = {
  title: 'Reset Password — Brain',
  description: 'Create a new password for your Brain account',
};

function ResetPasswordContent() {
  return <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <Suspense fallback={<div className="text-white">Loading...</div>}>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
