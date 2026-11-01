# التكامل مع منظومة iLogia

لا توجد تكاملات وهمية. الجدول يفرّق بين **الجاهز** و**ما يحتاج API أو صلاحيات**.

| النظام | الحالة | ما هو جاهز | ما يلزم |
|---|---|---|---|
| **iLogia App** | جاهز جزئيًا | روابط عميقة ثابتة: `https://library.ilogia-eg.com/#/resource/<id>` و`#/read/<id>` و`#/explore?subject=<id>&grade=<id>` و`#/my?tab=continue`. نفس مشروع Supabase ونفس `subjects`/`grades`. | زر «المكتبة» في التطبيق/الموقع الرئيسي (تعديل خارج هذا المستودع). تسجيل الدخول **لا يُشارك** تلقائيًا بين `ilogia-eg.com` والنطاق الفرعي لأن التخزين المحلي منفصل لكل نطاق. لمشاركة الجلسة يجب أن يستخدم الموقعان cookie على `.ilogia-eg.com` (يتطلب تعديل الموقع الرئيسي). |
| **iLogia Planner** | غير منفّذ | `library_reading_progress(user_id, resource_id, last_page, page_count, percent)` و`library_events` بيانات حقيقية يمكن للـ Planner قراءتها بنفس RLS. | تصميم جلسات المذاكرة في Planner وجدول يربط `resource_id` بجلسة. نقترح جدول `planner_session_resources` يملكه Planner. |
| **iLogia Cards** | غير منفّذ | `page_count` والملف الأصلي متاحان. | **آلية استخراج موثوقة**: نص PDF الممسوح ضوئيًا يحتاج OCR، والعربية تحديدًا تفقد ترتيب الحروف أحيانًا عند الاستخراج. لا نولّد كروتًا من نص غير موثوق. المقترح: Edge Function تستخرج النص وتحفظه في `library_resource_text` ثم يراجعه المعلم قبل توليد الكروت. |
| **iLogia Exams** | غير منفّذ | `subject_id`/`grade_id` مشتركان مع بقية المنصة. | API للامتحانات يعرض المواد/الوحدات لربط `library_resources` بها (جدول وسيط `exam_resources`). |
| **مصادر خارجية** | جاهز | `source = 'external'` + `external_url` (https فقط) يعمل من مركز الرفع، ويُفتح في تبويب جديد بـ `noopener`. | موافقة قانونية على كل مصدر خارجي؛ لا نعرض محتوى خارجيًا داخل iframe (CSP يمنعه). |
