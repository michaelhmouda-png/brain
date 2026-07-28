export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as Language);
}

export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : 'en';
}

const baseMessages = {
  en: {
    nav: { dashboard: 'Dashboard', brain: 'AI Assistant', tasks: 'My Tasks', notifications: 'My Notifications', shifts: 'My Schedule', settings: 'Settings', cameras: 'Cameras', signOut: 'Sign out', signingOut: 'Signing out...', account: 'Your Account', open: 'Open navigation', close: 'Close navigation' },
    tasks: { eyebrow: 'Tasks', title: 'Operational workflow', description: 'Live tasks in your authorized scope.', refresh: 'Refresh', loading: 'Loading tasks', access: 'Access unavailable', unable: 'Unable to load tasks', retry: 'Try again', emptyTitle: 'No tasks yet', empty: 'No tasks are assigned within your authorized task scope.', session: 'Your session has expired. Please sign in again.', unauthorized: 'Your account is not authorized for a company workspace.', unlinked: 'Your account is not linked to an employee record. Ask an owner or manager to complete the link.', failed: 'Tasks could not be loaded. Check your connection and try again.', unassigned: 'Unassigned', noDue: 'No due date', original: 'Original task', arabicTranslation: 'Arabic translation', translationPending: 'Arabic translation is not available yet.', complete: 'Mark complete', completing: 'Completing...', edit: 'Edit task', editEyebrow: 'Management edit', editTitle: 'Edit task', editTimezone: 'Company timezone', editClose: 'Close task editor', editTaskTitle: 'Title', editDescription: 'Description', editAssignee: 'Assigned employee', editLocation: 'Location', editNoLocation: 'No location', editPriority: 'Priority', editStatus: 'Status', editDueDate: 'Due date', editDueTime: 'Due time', editCancel: 'Cancel', editSave: 'Save changes', editSaving: 'Saving…', editField: 'Field', editConflict: 'This task changed after you opened it. Load the latest values before retrying.', editLoadLatest: 'Load latest values', editForbidden: 'You are not authorized to edit this task.', editLifecycle: 'This status change must use the dedicated task lifecycle.', editAssigneeInvalid: 'Choose an active employee in your company.', editLocationInvalid: 'Choose an active location in your company.', editInvalid: 'Review the highlighted task values and try again.', editFailed: 'The task could not be updated. Retry after checking your connection.' },
    status: { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' },
    priority: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
    notifications: { eyebrow: 'Updates', title: 'Notifications', markAll: 'Mark all read', settings: 'Settings', loading: 'Loading notifications…', unauthorized: 'You are not authorized to view notifications.', failed: 'Notifications could not be loaded.', offline: 'You are offline. Reconnect and retry.', retry: 'Retry', empty: 'No notifications yet.', open: 'Open', read: 'Mark read', archive: 'Archive', updateFailed: 'Notification update failed.', due30mPreference: '30-minute task reminders' },
    settings: { eyebrow: 'Settings', title: 'Personal settings', description: 'Manage your personal Brain preferences.', language: 'Language', languageHelp: 'This preference follows your account on every device.', english: 'English', arabic: 'العربية', save: 'Save language', saving: 'Saving…', saved: 'Language updated.', failed: 'Language could not be updated.' },
    brain: { intelligence: 'Operational Intelligence', thinking: 'Thinking...', confirming: 'Awaiting confirmation', executing: 'Executing...', done: 'Done', failed: 'Failed', welcome: 'Welcome to Brain', help: 'Ask about your tasks and personal operational information.', suggestions: 'Suggested questions', remaining: 'Requests remaining', confirm: 'Confirm', cancel: 'Cancel', edit: 'Edit', confirmTitle: 'Confirm before proceeding', placeholder: 'Ask Brain about your work...', send: 'Send', cancelled: 'Action cancelled.', quotaUnavailable: 'Quota status unavailable', genericError: 'An error occurred', evidenceQueued: 'Evidence attached to {task}. It is queued for AI verification. The task was not completed automatically.' },
    evidence: { attach: 'Attach task evidence', close: 'Close evidence upload', privacy: 'The original stays private and the task remains unchanged while evidence is queued for AI verification and review.', task: 'Task', loadingTasks: 'Loading tasks…', selectTask: 'Select a task', noActiveTasks: 'You have no active tasks requiring evidence.', takePhoto: 'Take photo', chooseGallery: 'Choose gallery', cameraHelp: 'Allow camera access when your browser asks.', galleryHelp: 'Choose an existing photo from your device.', preview: 'Selected evidence preview', remove: 'Remove selected image', preparing: 'Preparing secure upload', uploading: 'Uploading securely', progress: 'Upload progress', cancel: 'Cancel', confirm: 'Confirm upload', invalidFile: 'Choose a JPEG, PNG, WebP, HEIC, or HEIF image up to 20 MiB.', tasksFailed: 'Tasks could not be loaded. Please retry.', storageUnavailable: 'Evidence storage is unavailable.', uploadFailed: 'Upload failed. Check your connection and retry.', secureUploadFailed: 'Secure upload failed. Please retry.', prepareFailed: 'Evidence preparation failed.', finalizeFailed: 'Evidence finalization failed.', queuedReview: 'After upload, evidence will be queued for AI verification and may require human review.' },
    cameras: { eyebrow: 'Devices', title: 'Cameras', description: 'Secure camera and recorder metadata for your authorized locations.', location: 'Location', allLocations: 'All locations', addNvr: 'Add NVR', refresh: 'Refresh', retry: 'Retry', loading: 'Loading Camera Manager…', unavailable: 'Camera Manager is temporarily unavailable.', unauthorized: 'You are not authorized to access Camera Manager.', saveFailed: 'The metadata could not be saved.', removeFailed: 'The NVR could not be removed. Remove linked cameras first.', removeConfirm: 'Remove this NVR metadata?', total: 'Total cameras', online: 'Online', offline: 'Offline', aiEnabled: 'AI enabled', nvrs: 'NVR connections', cameras: 'Cameras', noLocations: 'No authorized active locations are available.', noNvrs: 'No NVR metadata configured for this location.', noCameras: 'No cameras have been configured. Channel discovery arrives with the local Brain Agent.', unknownLocation: 'Unknown location', unknownNvr: 'Unknown NVR', status: { unconfigured: 'Unconfigured', configured: 'Configured', offline: 'Offline', online: 'Online', error: 'Error', disabled: 'Disabled' }, localHost: 'Local host', lastTested: 'Last tested', never: 'Never', agentNotice: 'Connection testing will become available when a local Brain Agent is paired.', edit: 'Edit', remove: 'Remove', close: 'Close', editNvr: 'Edit NVR', name: 'Name', vendor: 'Vendor', httpPort: 'HTTP port', rtspPort: 'RTSP port', onvifPort: 'ONVIF port', usernameSecretReference: 'Username secret reference', passwordSecretReference: 'Password secret reference', secretNotice: 'Store reference identifiers only. Never enter a username or password here. Blank values clear existing references.', cancel: 'Cancel', save: 'Save', saving: 'Saving…', channel: 'Channel', unassigned: 'Unassigned', taskVerification: 'Task verification', editCamera: 'Edit camera', area: 'Area', department: 'Department', inspectWithAi: 'Inspect with AI', inspectingWithAi: 'Inspecting…', inspectionFailed: 'Inspection failed', inspectionResult: 'Camera inspection', inspectionHumanJudgment: 'Observations only. Human judgment is required; no tasks or alerts are created.', visionSkill: 'Vision Skill', runSkill: 'Run Skill', runningSkill: 'Running skill…', skillFailed: 'Vision Skill failed', skillResult: 'Vision Skill result', skillHumanJudgment: 'Advisory observations only. No tasks, alerts, scores, or automatic decisions are created.', skillOpeningReadiness: 'Opening Readiness', skillClosingReadiness: 'Closing Readiness', skillCleanliness: 'Cleanliness', skillSafety: 'Safety', skillEquipment: 'Equipment' },
    agents: { title: 'Local Brain Agents', description: 'Outbound-only venue agents. No local hardware is contacted in this phase.', add: 'Add agent', gatewayName: 'Agent name', pair: 'Generate pairing code', regenerate: 'Regenerate code', revokePairing: 'Revoke unused code', revokeAgent: 'Revoke agent', codeOnce: 'Copy this one-time code now. It will not be shown again.', expires: 'Expires', capability: 'Approved capability', noAgents: 'No Brain Agents configured for this location.', loading: 'Loading agents…', unavailable: 'Agent management is temporarily unavailable.', copied: 'Pairing code copied.', status: { unpaired: 'Unpaired', pairing: 'Pairing', online: 'Online', offline: 'Offline', disabled: 'Revoked or disabled', error: 'Error' }, lastSeen: 'Last seen', version: 'Version', platform: 'Platform', never: 'Never', close: 'Close', cancel: 'Cancel', create: 'Create agent', confirmRevoke: 'Revoke this agent credential immediately?' },
    home: { eyebrow: 'My shift', title: 'Welcome back', description: 'Your personal operational workspace.', tasks: 'Assigned tasks', today: 'Due today', overdue: 'Overdue', notifications: 'Recent notifications', schedule: 'Upcoming shifts', viewTasks: 'View my tasks', askBrain: 'Ask Brain', noShifts: 'No upcoming shifts.', unavailable: 'Personal overview is temporarily unavailable.' },
    role: { super_admin: 'Super Admin', owner: 'Owner', manager: 'Manager', employee: 'Employee' },
  },
  ar: {
    nav: { dashboard: 'الرئيسية', brain: 'مساعد برين', tasks: 'مهامي', notifications: 'إشعاراتي', shifts: 'جدولي', settings: 'الإعدادات', cameras: 'الكاميرات', signOut: 'تسجيل الخروج', signingOut: 'جارٍ تسجيل الخروج...', account: 'حسابي', open: 'فتح القائمة', close: 'إغلاق القائمة' },
    tasks: { eyebrow: 'المهام', title: 'سير العمل التشغيلي', description: 'المهام المباشرة ضمن صلاحياتك.', refresh: 'تحديث', loading: 'جارٍ تحميل المهام', access: 'الوصول غير متاح', unable: 'تعذّر تحميل المهام', retry: 'حاول مجددًا', emptyTitle: 'لا توجد مهام', empty: 'لا توجد مهام مسندة إليك حاليًا.', session: 'انتهت جلستك. يرجى تسجيل الدخول مجددًا.', unauthorized: 'حسابك غير مخوّل لمساحة عمل الشركة.', unlinked: 'حسابك غير مربوط بسجل موظف. اطلب من المالك أو المدير إكمال الربط.', failed: 'تعذّر تحميل المهام. تحقق من الاتصال وحاول مجددًا.', unassigned: 'غير مسندة', noDue: 'من دون موعد', original: 'المهمة الأصلية', arabicTranslation: 'الترجمة العربية', translationPending: 'الترجمة العربية غير متاحة بعد.', complete: 'تحديد كمكتملة', completing: 'جارٍ الإكمال...', edit: 'تعديل المهمة', editEyebrow: 'تعديل إداري', editTitle: 'تعديل المهمة', editTimezone: 'توقيت الشركة', editClose: 'إغلاق محرر المهمة', editTaskTitle: 'العنوان', editDescription: 'الوصف', editAssignee: 'الموظف المكلّف', editLocation: 'الموقع', editNoLocation: 'من دون موقع', editPriority: 'الأولوية', editStatus: 'الحالة', editDueDate: 'تاريخ الاستحقاق', editDueTime: 'وقت الاستحقاق', editCancel: 'إلغاء', editSave: 'حفظ التغييرات', editSaving: 'جارٍ الحفظ…', editField: 'الحقل', editConflict: 'تغيّرت هذه المهمة بعد فتحها. حمّل أحدث القيم قبل إعادة المحاولة.', editLoadLatest: 'تحميل أحدث القيم', editForbidden: 'ليست لديك صلاحية تعديل هذه المهمة.', editLifecycle: 'يجب تنفيذ تغيير الحالة هذا عبر مسار دورة حياة المهمة المخصص.', editAssigneeInvalid: 'اختر موظفًا نشطًا ضمن شركتك.', editLocationInvalid: 'اختر موقعًا نشطًا ضمن شركتك.', editInvalid: 'راجع قيم المهمة وحاول مجددًا.', editFailed: 'تعذّر تحديث المهمة. تحقق من الاتصال ثم حاول مجددًا.' },
    status: { pending: 'قيد الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتملة', cancelled: 'ملغاة' },
    priority: { critical: 'حرجة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
    notifications: { eyebrow: 'التحديثات', title: 'الإشعارات', markAll: 'تحديد الكل كمقروء', settings: 'الإعدادات', loading: 'جارٍ تحميل الإشعارات…', unauthorized: 'غير مخوّل لعرض الإشعارات.', failed: 'تعذّر تحميل الإشعارات.', offline: 'لا يوجد اتصال. أعد الاتصال وحاول مجددًا.', retry: 'إعادة المحاولة', empty: 'لا توجد إشعارات بعد.', open: 'فتح', read: 'تحديد كمقروء', archive: 'أرشفة', updateFailed: 'تعذّر تحديث الإشعار.', due30mPreference: 'تذكيرات المهام قبل 30 دقيقة' },
    settings: { eyebrow: 'الإعدادات', title: 'الإعدادات الشخصية', description: 'إدارة تفضيلات حساب برين.', language: 'اللغة', languageHelp: 'يتبع هذا التفضيل حسابك على كل الأجهزة.', english: 'English', arabic: 'العربية', save: 'حفظ اللغة', saving: 'جارٍ الحفظ...', saved: 'تم تحديث اللغة.', failed: 'تعذّر تحديث اللغة.' },
    brain: { intelligence: 'الذكاء التشغيلي', thinking: 'عم فكّر...', confirming: 'بانتظار التأكيد', executing: 'جارٍ التنفيذ...', done: 'تم', failed: 'فشل', welcome: 'أهلًا بك في برين', help: 'اسأل عن مهامك ومعلوماتك التشغيلية الشخصية.', suggestions: 'أسئلة مقترحة', remaining: 'الطلبات المتبقية', confirm: 'تأكيد', cancel: 'إلغاء', edit: 'تعديل', confirmTitle: 'أكد قبل المتابعة', placeholder: 'اسأل برين عن شغلك...', send: 'إرسال', cancelled: 'تم إلغاء الإجراء.', quotaUnavailable: 'حالة الحصة غير متاحة', genericError: 'حدث خطأ', evidenceQueued: 'تم إرفاق الدليل بالمهمة {task}. وهو بانتظار التحقق بالذكاء الاصطناعي. لم تُستكمل المهمة تلقائيًا.' },
    evidence: { attach: 'إرفاق دليل للمهمة', close: 'إغلاق نافذة رفع الدليل', privacy: 'يبقى الملف الأصلي خاصاً، ولا تتغير حالة المهمة أثناء انتظار التحقق بالذكاء الاصطناعي والمراجعة.', task: 'المهمة', loadingTasks: 'جارٍ تحميل المهام…', selectTask: 'اختر مهمة', noActiveTasks: 'لا توجد لديك مهام نشطة تتطلب دليلاً.', takePhoto: 'التقاط صورة', chooseGallery: 'اختيار من معرض الصور', cameraHelp: 'اسمح بالوصول إلى الكاميرا عندما يطلب المتصفح ذلك.', galleryHelp: 'اختر صورة موجودة على جهازك.', preview: 'معاينة الدليل المحدد', remove: 'إزالة الصورة المحددة', preparing: 'جارٍ تجهيز الرفع الآمن', uploading: 'جارٍ الرفع بأمان', progress: 'تقدم الرفع', cancel: 'إلغاء', confirm: 'تأكيد الرفع', invalidFile: 'اختر صورة JPEG أو PNG أو WebP أو HEIC أو HEIF بحجم لا يتجاوز 20 MiB.', tasksFailed: 'تعذّر تحميل المهام. حاول مجدداً.', storageUnavailable: 'خدمة حفظ الأدلة غير متاحة حالياً.', uploadFailed: 'تعذّر رفع الدليل. تحقق من الاتصال وحاول مجدداً.', secureUploadFailed: 'تعذّر الرفع الآمن. حاول مجدداً.', prepareFailed: 'تعذّر تجهيز الدليل للرفع.', finalizeFailed: 'تعذّر إكمال تسجيل الدليل.', queuedReview: 'بعد الرفع، سيُرسل الدليل للتحقق بالذكاء الاصطناعي وقد يحتاج إلى مراجعة بشرية.' },
    cameras: { eyebrow: 'الأجهزة', title: 'الكاميرات', description: 'إدارة آمنة لبيانات الكاميرات وأجهزة التسجيل في المواقع المصرّح بها.', location: 'الموقع', allLocations: 'كل المواقع', addNvr: 'إضافة جهاز تسجيل', refresh: 'تحديث', retry: 'إعادة المحاولة', loading: 'جارٍ تحميل إدارة الكاميرات…', unavailable: 'إدارة الكاميرات غير متاحة مؤقتاً.', unauthorized: 'ليس لديك صلاحية للوصول إلى إدارة الكاميرات.', saveFailed: 'تعذّر حفظ البيانات.', removeFailed: 'تعذّر حذف جهاز التسجيل. احذف الكاميرات المرتبطة أولاً.', removeConfirm: 'هل تريد حذف بيانات جهاز التسجيل؟', total: 'مجموع الكاميرات', online: 'متصلة', offline: 'غير متصلة', aiEnabled: 'الذكاء الاصطناعي مفعّل', nvrs: 'أجهزة التسجيل', cameras: 'الكاميرات', noLocations: 'لا توجد مواقع نشطة مصرّح بها.', noNvrs: 'لا توجد بيانات جهاز تسجيل لهذا الموقع.', noCameras: 'لم تتم تهيئة كاميرات بعد. سيصبح اكتشاف القنوات متاحاً مع وكيل برين المحلي.', unknownLocation: 'موقع غير معروف', unknownNvr: 'جهاز تسجيل غير معروف', status: { unconfigured: 'غير مهيّأ', configured: 'مهيّأ', offline: 'غير متصل', online: 'متصل', error: 'خطأ', disabled: 'معطّل' }, localHost: 'المضيف المحلي', lastTested: 'آخر اختبار', never: 'لم يُختبر', agentNotice: 'سيصبح اختبار الاتصال متاحاً بعد إقران وكيل برين المحلي.', edit: 'تعديل', remove: 'حذف', close: 'إغلاق', editNvr: 'تعديل جهاز التسجيل', name: 'الاسم', vendor: 'الشركة المصنّعة', httpPort: 'منفذ HTTP', rtspPort: 'منفذ RTSP', onvifPort: 'منفذ ONVIF', usernameSecretReference: 'مرجع سر اسم المستخدم', passwordSecretReference: 'مرجع سر كلمة المرور', secretNotice: 'أدخل معرّفات المراجع فقط، ولا تدخل اسم مستخدم أو كلمة مرور هنا. الحقول الفارغة تمسح المراجع الحالية.', cancel: 'إلغاء', save: 'حفظ', saving: 'جارٍ الحفظ…', channel: 'القناة', unassigned: 'غير محدد', taskVerification: 'التحقق من المهام', editCamera: 'تعديل الكاميرا', area: 'المنطقة', department: 'القسم', inspectWithAi: 'فحص بالذكاء الاصطناعي', inspectingWithAi: 'جارٍ الفحص…', inspectionFailed: 'فشل الفحص', inspectionResult: 'فحص الكاميرا', inspectionHumanJudgment: 'ملاحظات فقط. يلزم الحكم البشري ولا يتم إنشاء مهام أو تنبيهات.', visionSkill: 'مهارة الرؤية', runSkill: 'تشغيل المهارة', runningSkill: 'جارٍ تشغيل المهارة…', skillFailed: 'فشلت مهارة الرؤية', skillResult: 'نتيجة مهارة الرؤية', skillHumanJudgment: 'ملاحظات استشارية فقط. لا يتم إنشاء مهام أو تنبيهات أو درجات أو قرارات تلقائية.', skillOpeningReadiness: 'جاهزية الافتتاح', skillClosingReadiness: 'جاهزية الإغلاق', skillCleanliness: 'النظافة', skillSafety: 'السلامة', skillEquipment: 'المعدات' },
    agents: { title: 'وكلاء برين المحليون', description: 'وكلاء للموقع باتصال خارجي فقط. لا يتم الاتصال بأي جهاز محلي في هذه المرحلة.', add: 'إضافة وكيل', gatewayName: 'اسم الوكيل', pair: 'إنشاء رمز إقران', regenerate: 'إعادة إنشاء الرمز', revokePairing: 'إلغاء الرمز غير المستخدم', revokeAgent: 'إلغاء الوكيل', codeOnce: 'انسخ هذا الرمز الآن. لن يظهر مرة أخرى.', expires: 'ينتهي', capability: 'الصلاحية المعتمدة', noAgents: 'لا يوجد وكلاء برين لهذا الموقع.', loading: 'جارٍ تحميل الوكلاء…', unavailable: 'إدارة الوكلاء غير متاحة مؤقتاً.', copied: 'تم نسخ رمز الإقران.', status: { unpaired: 'غير مقترن', pairing: 'بانتظار الإقران', online: 'متصل', offline: 'غير متصل', disabled: 'ملغى أو معطّل', error: 'خطأ' }, lastSeen: 'آخر اتصال', version: 'الإصدار', platform: 'النظام', never: 'أبداً', close: 'إغلاق', cancel: 'إلغاء', create: 'إنشاء وكيل', confirmRevoke: 'هل تريد إلغاء اعتماد هذا الوكيل فوراً؟' },
    home: { eyebrow: 'ورديتي', title: 'أهلًا بعودتك', description: 'مساحة عملك التشغيلية الشخصية.', tasks: 'المهام المسندة', today: 'مستحقة اليوم', overdue: 'متأخرة', notifications: 'أحدث الإشعارات', schedule: 'الورديات القادمة', viewTasks: 'عرض مهامي', askBrain: 'اسأل برين', noShifts: 'لا توجد ورديات قادمة.', unavailable: 'الملخص الشخصي غير متاح مؤقتًا.' },
    role: { super_admin: 'مشرف عام', owner: 'مالك', manager: 'مدير', employee: 'موظف' },
  },
} as const;

const v3Messages = {
  en: {
    navigation: {
      brandSubtitle: 'Hospitality OS', search: 'Search', searchBrain: 'Search Brain',
      primaryLabel: 'Primary navigation', quickLabel: 'Quick navigation', drawerLabel: 'Navigation',
      navigate: 'Navigate', workspace: 'Workspace', organization: 'Organization', brain: 'Brain',
      operator: 'Brain operator',
      destinations: {
        home: { label: 'Home', description: 'Today’s briefing and priorities', keywords: 'briefing score today' },
        operations: { label: 'Operations', description: 'Live operational work', keywords: 'overview command center' },
        reservations: { label: 'Reservations', description: 'Bookings, waitlist, and service calendar', keywords: 'booking calendar waiting list calls' },
        guests: { label: 'Guests', description: 'Guest profiles and memory', keywords: 'customers people profiles' },
        tasks: { label: 'Tasks', description: 'Assigned and overdue work', keywords: 'to do overdue work' },
        schedule: { label: 'Schedule', description: 'Team shifts and coverage', keywords: 'roster employees hours' },
        notifications: { label: 'Notifications', description: 'Updates that need your attention', keywords: 'alerts inbox' },
        evidenceReview: { label: 'Evidence review', description: 'Manager review queue', keywords: 'task proof approvals' },
        inventory: { label: 'Inventory', description: 'Stock health and alerts', keywords: 'stock supplies low stock' },
        maintenance: { label: 'Maintenance', description: 'Issues, repairs, and equipment', keywords: 'tickets repair' },
        incidents: { label: 'Incidents', description: 'Operational incident records', keywords: 'reports safety' },
        cameras: { label: 'Cameras', description: 'Camera Manager and inspections', keywords: 'nvr vision agent' },
        timeline: { label: 'Timeline', description: 'Durable operational history', keywords: 'events history' },
        team: { label: 'Team', description: 'Employees and profiles', keywords: 'staff employees people' },
        announcements: { label: 'Announcements', description: 'Company updates', keywords: 'news posts' },
        companies: { label: 'Companies', description: 'Hospitality business profiles', keywords: 'brands tenant' },
        locations: { label: 'Locations', description: 'Venues and service settings', keywords: 'venues branches' },
        departments: { label: 'Departments', description: 'Team structure', keywords: 'areas organization' },
        analytics: { label: 'Analytics', description: 'Performance overview', keywords: 'reports metrics' },
        settings: { label: 'Settings', description: 'Preferences and notifications', keywords: 'account language' },
      },
    },
    shell: {
      yourCompany: 'Your company', currentAuthorizedView: 'Current authorized view', you: 'You',
      openBrain: 'Open Brain', closeBrain: 'Close Brain', operationalIntelligence: 'Your operational intelligence',
      currentPageContext: 'Current page context', viewing: 'You are viewing', recentConversation: 'Recent conversation',
      closeSearch: 'Close search', searchPlaceholder: 'Search reservations, guests, tasks, people…',
      escape: 'Esc', records: 'Records', searching: 'Searching your authorized workspace…',
      noRecords: 'No matching records in your authorized scope.', modulesAndWorkflows: 'Modules and workflows',
      goAnywhere: 'Go anywhere', noDestination: 'No destination found',
      noDestinationHelp: 'Try a module, workflow, or record type.', task: 'Task', reservation: 'Reservation',
      incident: 'Incident', maintenance: 'Maintenance', details: 'Details', new: 'New',
      calendar: 'Calendar', today: 'Today',
      modules: {
        reservations: 'Reservations', timeline: 'Timeline', tasks: 'Tasks', cameras: 'Cameras',
        employees: 'Employees', inventory: 'Inventory', maintenance: 'Maintenance', incidents: 'Incidents',
        operations: 'Operations', schedule: 'Schedule', notifications: 'Notifications', settings: 'Settings',
        home: 'Home', brain: 'Brain',
      },
    },
    assistant: {
      unavailable: 'Brain is temporarily unavailable.', requestFailed: 'Brain could not complete that request.',
      cancelFailed: 'Brain could not cancel that action.', actionCancelled: 'The proposed action was cancelled.',
      greeting: 'How can I help?', contextHelp: 'Brain already knows which part of the operation you are viewing.',
      suggested: 'Suggested', executing: 'Completing the approved action…', thinking: 'Thinking…',
      confirmAction: 'Confirm {action}', cancel: 'Cancel', confirm: 'Confirm', inputLabel: 'Ask Brain',
      placeholder: 'Ask about {module}…', send: 'Send message', evidencePrivate: 'Evidence stays private',
      requestsLeft: '{count} requests left', connecting: 'Connecting…',
      compatibilityOpening: 'Opening Brain…',
      compatibilityHelp: 'Brain now stays with you across the entire operation.',
      suggestions: {
        reservations: ['What needs attention today?', 'Summarize the waiting list.', 'What is the next arrival?'],
        operations: ['What needs attention now?', 'Show everything overdue.', 'Summarize today’s operations.'],
        tasks: ['What is overdue?', 'What should be prioritized first?', 'Show today’s active work.'],
        cameras: ['Summarize camera readiness.', 'Which camera needs attention?', 'Explain the latest inspection.'],
        employees: ['Summarize team coverage.', 'Who has active tasks?', 'What needs a manager’s attention?'],
        default: ['What needs attention today?', 'Summarize this view.', 'What should I do next?'],
      },
    },
    schedule: {
      personalTitle: 'My schedule', personalDescription: 'View your shifts and working times.',
      managementTitle: 'Shift management', managementDescription: 'View company schedules and coverage.',
      previousWeek: 'Previous week', nextWeek: 'Next week', weekOf: 'Week of {date}',
      employee: 'Employee', you: 'You', scheduled: 'Scheduled', noShift: 'No shift',
      noSchedules: 'No shifts for this week.', noManagementSchedules: 'No schedules for this week.',
      employeesScheduled: 'Employees scheduled', swapsPending: 'Shift swaps pending',
      timeOffRequests: 'Time off requests', loading: 'Loading schedule…',
      failed: 'Schedule could not be loaded.', unauthorized: 'You are not authorized to view this schedule.',
      retry: 'Try again', tableLabel: 'Weekly shifts table',
      days: { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' },
    },
    notificationSettings: {
      title: 'Notification settings',
      description: 'Browser and OS permission is required. Permission is requested only when you choose Enable notifications.',
      permissionState: 'Permission state: {state}',
      states: { unsupported: 'Unsupported', not_requested: 'Not requested', denied: 'Denied', enabled: 'Enabled', expired: 'Needs renewal' },
      unsupported: 'Push is not supported by this browser.',
      denied: 'Permission was denied. Enable notifications in your browser or device settings; Brain will not ask repeatedly.',
      iphone: 'On iPhone, install Brain to the Home Screen and enable notifications from the installed web app where supported.',
      enable: 'Enable notifications', disable: 'Disable this device',
      enabledMessage: 'Browser notifications enabled on this device.',
      enableFailed: 'Notifications could not be enabled. Retry after checking browser settings.',
      saved: 'Notification preferences saved.', saveFailed: 'Preferences could not be saved.',
      save: 'Save preferences', inApp: 'In-app notifications', quietHours: 'Quiet hours',
      start: 'Start', end: 'End', unreadCount: '{count} unread notifications',
      loading: 'Loading preferences…', loadFailed: 'Preferences could not be loaded.',
      retry: 'Retry', saving: 'Saving…',
      categories: {
        taskAssignments: 'Task assignments', taskUpdates: 'Task updates',
        dueReminders: '30-minute task reminders', announcements: 'Announcements',
        maintenance: 'Maintenance', incidents: 'Incidents', evidenceReview: 'Evidence review',
      },
    },
    notificationCategory: {
      task_assignment: 'Task assignment', task_update: 'Task update', due_reminder: 'Task reminder',
      announcement: 'Announcement', maintenance: 'Maintenance', incident: 'Incident',
      evidence_review: 'Evidence review', system: 'System',
    },
    accountState: {
      authenticationError: 'Authentication error',
      authenticationHelp: 'Unable to verify your authentication. Please sign in again.',
      setupRequired: 'Account setup required',
      setupHelp: 'Your account has not been set up yet. Please contact your administrator.',
      userId: 'User ID', inactive: 'Account inactive',
      inactiveHelp: 'Your account is currently {status}. Please contact your administrator.',
    },
    profileStatus: { active: 'Active', inactive: 'Inactive', suspended: 'Suspended' },
    settingsCards: {
      workspace: { label: 'Workspace', description: 'Venue preferences and branding' },
      notifications: { label: 'Notifications', description: 'Alert thresholds and channels' },
      security: { label: 'Security', description: 'Access controls and audit' },
    },
    evidenceState: {
      pending_upload: 'Pending upload', upload_failed: 'Upload failed', pending_review: 'Pending review',
      queued: 'Queued', processing: 'Processing', ai_verified: 'AI verified', ai_rejected: 'AI rejected',
      needs_human_review: 'Needs human review', human_approved: 'Approved',
      human_rejected: 'Rejected', verification_failed: 'Verification failed',
    },
  },
  ar: {
    navigation: {
      brandSubtitle: 'نظام تشغيل الضيافة', search: 'بحث', searchBrain: 'البحث في برين',
      primaryLabel: 'التنقل الرئيسي', quickLabel: 'التنقل السريع', drawerLabel: 'التنقل',
      navigate: 'انتقل إلى', workspace: 'مساحة العمل', organization: 'المؤسسة', brain: 'برين',
      operator: 'مستخدم برين',
      destinations: {
        home: { label: 'الرئيسية', description: 'ملخص اليوم والأولويات', keywords: 'ملخص نتيجة اليوم' },
        operations: { label: 'العمليات', description: 'العمل التشغيلي المباشر', keywords: 'نظرة عامة مركز العمليات' },
        reservations: { label: 'الحجوزات', description: 'الحجوزات وقائمة الانتظار وتقويم الخدمة', keywords: 'حجز تقويم انتظار مكالمات' },
        guests: { label: 'الضيوف', description: 'ملفات الضيوف وسجلهم', keywords: 'عملاء أشخاص ملفات' },
        tasks: { label: 'المهام', description: 'العمل المسند والمتأخر', keywords: 'مهام متأخرة عمل' },
        schedule: { label: 'الجدول', description: 'ورديات الفريق والتغطية', keywords: 'ورديات موظفون ساعات' },
        notifications: { label: 'الإشعارات', description: 'تحديثات تحتاج إلى انتباهك', keywords: 'تنبيهات وارد' },
        evidenceReview: { label: 'مراجعة الأدلة', description: 'قائمة مراجعة المدير', keywords: 'دليل مهمة موافقات' },
        inventory: { label: 'المخزون', description: 'حالة المخزون والتنبيهات', keywords: 'مخزون لوازم نقص' },
        maintenance: { label: 'الصيانة', description: 'المشكلات والإصلاحات والمعدات', keywords: 'تذاكر إصلاح' },
        incidents: { label: 'الحوادث', description: 'سجلات الحوادث التشغيلية', keywords: 'تقارير سلامة' },
        cameras: { label: 'الكاميرات', description: 'إدارة الكاميرات وعمليات الفحص', keywords: 'مسجل رؤية وكيل' },
        timeline: { label: 'السجل الزمني', description: 'السجل التشغيلي الدائم', keywords: 'أحداث سجل' },
        team: { label: 'الفريق', description: 'الموظفون وملفاتهم', keywords: 'طاقم موظفون أشخاص' },
        announcements: { label: 'الإعلانات', description: 'تحديثات الشركة', keywords: 'أخبار منشورات' },
        companies: { label: 'الشركات', description: 'ملفات منشآت الضيافة', keywords: 'علامات مستأجر' },
        locations: { label: 'المواقع', description: 'الفروع وإعدادات الخدمة', keywords: 'فروع مواقع' },
        departments: { label: 'الأقسام', description: 'هيكل الفريق', keywords: 'مناطق مؤسسة' },
        analytics: { label: 'التحليلات', description: 'نظرة عامة على الأداء', keywords: 'تقارير مقاييس' },
        settings: { label: 'الإعدادات', description: 'التفضيلات والإشعارات', keywords: 'حساب لغة' },
      },
    },
    shell: {
      yourCompany: 'شركتك', currentAuthorizedView: 'العرض المصرح لك به حاليًا', you: 'أنت',
      openBrain: 'فتح برين', closeBrain: 'إغلاق برين', operationalIntelligence: 'ذكاؤك التشغيلي',
      currentPageContext: 'سياق الصفحة الحالية', viewing: 'أنت تعرض', recentConversation: 'المحادثة الأخيرة',
      closeSearch: 'إغلاق البحث', searchPlaceholder: 'ابحث في الحجوزات والضيوف والمهام والأشخاص…',
      escape: 'Esc', records: 'السجلات', searching: 'جارٍ البحث ضمن مساحة عملك المصرح بها…',
      noRecords: 'لا توجد سجلات مطابقة ضمن نطاق صلاحياتك.', modulesAndWorkflows: 'الوحدات ومسارات العمل',
      goAnywhere: 'انتقل إلى أي مكان', noDestination: 'لم يتم العثور على وجهة',
      noDestinationHelp: 'جرّب اسم وحدة أو مسار عمل أو نوع سجل.', task: 'مهمة', reservation: 'حجز',
      incident: 'حادث', maintenance: 'صيانة', details: 'التفاصيل', new: 'جديد',
      calendar: 'التقويم', today: 'اليوم',
      modules: {
        reservations: 'الحجوزات', timeline: 'السجل الزمني', tasks: 'المهام', cameras: 'الكاميرات',
        employees: 'الموظفون', inventory: 'المخزون', maintenance: 'الصيانة', incidents: 'الحوادث',
        operations: 'العمليات', schedule: 'الجدول', notifications: 'الإشعارات', settings: 'الإعدادات',
        home: 'الرئيسية', brain: 'برين',
      },
    },
    assistant: {
      unavailable: 'برين غير متاح مؤقتًا.', requestFailed: 'تعذّر على برين إكمال هذا الطلب.',
      cancelFailed: 'تعذّر على برين إلغاء هذا الإجراء.', actionCancelled: 'تم إلغاء الإجراء المقترح.',
      greeting: 'كيف يمكنني مساعدتك؟', contextHelp: 'يعرف برين القسم التشغيلي الذي تعرضه حاليًا.',
      suggested: 'مقترح', executing: 'جارٍ إكمال الإجراء الموافق عليه…', thinking: 'جارٍ التفكير…',
      confirmAction: 'تأكيد {action}', cancel: 'إلغاء', confirm: 'تأكيد', inputLabel: 'اسأل برين',
      placeholder: 'اسأل عن {module}…', send: 'إرسال الرسالة', evidencePrivate: 'تبقى الأدلة خاصة',
      requestsLeft: '{count} طلبات متبقية', connecting: 'جارٍ الاتصال…',
      compatibilityOpening: 'جارٍ فتح برين…',
      compatibilityHelp: 'برين يبقى معك الآن في كل أنحاء التشغيل.',
      suggestions: {
        reservations: ['ما الذي يحتاج إلى انتباه اليوم؟', 'لخّص قائمة الانتظار.', 'ما هو الوصول التالي؟'],
        operations: ['ما الذي يحتاج إلى الانتباه الآن؟', 'اعرض كل ما هو متأخر.', 'لخّص عمليات اليوم.'],
        tasks: ['ما المهام المتأخرة؟', 'ما الذي يجب إعطاؤه الأولوية؟', 'اعرض عمل اليوم النشط.'],
        cameras: ['لخّص جاهزية الكاميرات.', 'أي كاميرا تحتاج إلى الانتباه؟', 'اشرح نتيجة الفحص الأخيرة.'],
        employees: ['لخّص تغطية الفريق.', 'من لديه مهام نشطة؟', 'ما الذي يحتاج إلى انتباه المدير؟'],
        default: ['ما الذي يحتاج إلى انتباه اليوم؟', 'لخّص هذا العرض.', 'ماذا أفعل بعد ذلك؟'],
      },
    },
    schedule: {
      personalTitle: 'جدولي', personalDescription: 'عرض وردياتك ومواعيد عملك.',
      managementTitle: 'إدارة الورديات', managementDescription: 'عرض جداول الشركة والتغطية.',
      previousWeek: 'الأسبوع السابق', nextWeek: 'الأسبوع التالي', weekOf: 'أسبوع {date}',
      employee: 'الموظف', you: 'أنت', scheduled: 'مجدول', noShift: 'لا توجد وردية',
      noSchedules: 'لا توجد ورديات لك هذا الأسبوع.', noManagementSchedules: 'لا توجد جداول لهذا الأسبوع.',
      employeesScheduled: 'الموظفون المجدولون', swapsPending: 'طلبات تبديل الورديات',
      timeOffRequests: 'طلبات الإجازة', loading: 'جارٍ تحميل الجدول…',
      failed: 'تعذّر تحميل الجدول.', unauthorized: 'ليست لديك صلاحية عرض هذا الجدول.',
      retry: 'حاول مجددًا', tableLabel: 'جدول الورديات الأسبوعي',
      days: { monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة', saturday: 'السبت', sunday: 'الأحد' },
    },
    notificationSettings: {
      title: 'إعدادات الإشعارات',
      description: 'يلزم إذن المتصفح ونظام التشغيل. لن نطلب الإذن إلا عند اختيار تفعيل الإشعارات.',
      permissionState: 'حالة الإذن: {state}',
      states: { unsupported: 'غير مدعوم', not_requested: 'لم يُطلب', denied: 'مرفوض', enabled: 'مفعّل', expired: 'يحتاج إلى تجديد' },
      unsupported: 'هذا المتصفح لا يدعم الإشعارات الفورية.',
      denied: 'تم رفض الإذن. فعّل الإشعارات من إعدادات المتصفح أو الجهاز؛ لن يكرر برين الطلب.',
      iphone: 'على iPhone، أضف برين إلى الشاشة الرئيسية ثم فعّل الإشعارات من تطبيق الويب المثبّت حيث يكون ذلك مدعومًا.',
      enable: 'تفعيل الإشعارات', disable: 'تعطيل هذا الجهاز',
      enabledMessage: 'تم تفعيل إشعارات المتصفح على هذا الجهاز.',
      enableFailed: 'تعذّر تفعيل الإشعارات. تحقق من إعدادات المتصفح ثم حاول مجددًا.',
      saved: 'تم حفظ تفضيلات الإشعارات.', saveFailed: 'تعذّر حفظ التفضيلات.',
      save: 'حفظ التفضيلات', inApp: 'الإشعارات داخل التطبيق', quietHours: 'ساعات الهدوء',
      start: 'البداية', end: 'النهاية', unreadCount: '{count} إشعارات غير مقروءة',
      loading: 'جارٍ تحميل التفضيلات…', loadFailed: 'تعذّر تحميل التفضيلات.',
      retry: 'إعادة المحاولة', saving: 'جارٍ الحفظ…',
      categories: {
        taskAssignments: 'إسناد المهام', taskUpdates: 'تحديثات المهام',
        dueReminders: 'تذكيرات المهام قبل 30 دقيقة', announcements: 'الإعلانات',
        maintenance: 'الصيانة', incidents: 'الحوادث', evidenceReview: 'مراجعة الأدلة',
      },
    },
    notificationCategory: {
      task_assignment: 'إسناد مهمة', task_update: 'تحديث مهمة', due_reminder: 'تذكير بمهمة',
      announcement: 'إعلان', maintenance: 'صيانة', incident: 'حادث',
      evidence_review: 'مراجعة دليل', system: 'النظام',
    },
    accountState: {
      authenticationError: 'خطأ في المصادقة',
      authenticationHelp: 'تعذّر التحقق من تسجيل دخولك. يرجى تسجيل الدخول مجددًا.',
      setupRequired: 'يلزم إعداد الحساب', setupHelp: 'لم يتم إعداد حسابك بعد. تواصل مع المسؤول.',
      userId: 'معرّف المستخدم', inactive: 'الحساب غير نشط',
      inactiveHelp: 'حسابك حاليًا {status}. تواصل مع المسؤول.',
    },
    profileStatus: { active: 'نشط', inactive: 'غير نشط', suspended: 'موقوف' },
    settingsCards: {
      workspace: { label: 'مساحة العمل', description: 'تفضيلات الموقع والهوية' },
      notifications: { label: 'الإشعارات', description: 'حدود التنبيهات وقنواتها' },
      security: { label: 'الأمان', description: 'ضوابط الوصول والسجل' },
    },
    evidenceState: {
      pending_upload: 'بانتظار الرفع', upload_failed: 'فشل الرفع', pending_review: 'بانتظار المراجعة',
      queued: 'في قائمة الانتظار', processing: 'قيد المعالجة', ai_verified: 'تم التحقق بالذكاء الاصطناعي',
      ai_rejected: 'رفضه الذكاء الاصطناعي', needs_human_review: 'تحتاج إلى مراجعة بشرية',
      human_approved: 'مقبول', human_rejected: 'مرفوض', verification_failed: 'فشل التحقق',
    },
  },
} as const;

export const messages = {
  en: { ...baseMessages.en, ...v3Messages.en },
  ar: { ...baseMessages.ar, ...v3Messages.ar },
} as const;

export type TranslationMessages = (typeof messages)['en'];

type TranslationCatalog = Record<string, unknown>;

function collectCatalogProblems(reference: TranslationCatalog, candidate: TranslationCatalog, prefix = ''): string[] {
  const problems: string[] = [];
  for (const [key, expected] of Object.entries(reference)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const actual = candidate[key];
    if (typeof expected === 'string') {
      if (typeof actual !== 'string' || !actual.trim()) problems.push(path);
    } else if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((item) => typeof item !== 'string' || !item.trim())) problems.push(path);
    } else if (expected && typeof expected === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) problems.push(path);
      else problems.push(...collectCatalogProblems(expected as TranslationCatalog, actual as TranslationCatalog, path));
    }
  }
  for (const key of Object.keys(candidate)) {
    if (!(key in reference)) problems.push(prefix ? `${prefix}.${key}` : key);
  }
  return problems;
}

export function validateTranslationCatalog(
  reference: TranslationCatalog = messages.en,
  candidate: TranslationCatalog = messages.ar,
): string[] {
  return collectCatalogProblems(reference, candidate);
}

export function getMessages(language: Language): TranslationMessages {
  const problems = validateTranslationCatalog();
  if (problems.length > 0) {
    if (process.env.NODE_ENV !== 'production') console.error('[i18n] I18N_CATALOG_INCOMPLETE', { keys: problems });
    throw new Error('I18N_CATALOG_INCOMPLETE');
  }
  return messages[language] as TranslationMessages;
}

export function interpolateMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}
