-- BG1 X1 (egasi qarori 26.11.2026): «Barcha filiallar» doirasi istalgan rolga beriladi (faqat Buxgalter emas).
-- «4 ta filial bitta joyda, xodimlar hammasiga umumiy» — masalan, yigʻuvchi yoki haydovchi barcha filiallarda ishlaydi.
-- V48 dagi cheklov (belgi faqat Buxgalterda) olib tashlanadi; belgini faqat Direktor beradi (API, audit: employee.allBranches).
DROP TRIGGER employee_all_branches_guard ON employee;
DROP FUNCTION employee_all_branches_guard();

COMMENT ON COLUMN employee.all_branches IS
    'Barcha filiallar doirasi — istalgan rol (BG1 X1); faqat Direktor yoqadi, audit: employee.allBranches. Tanlash roʻyxatlarida har filialda koʻrinadi';
