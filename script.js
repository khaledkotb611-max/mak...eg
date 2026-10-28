document.documentElement.classList.add("js");

document.querySelectorAll(".stats [data-counter]").forEach((counter) => counter.removeAttribute("data-counter"));

const WHATSAPP_NUMBER = "201282708833";
const ORDER_EMAIL = "khaledkotb611@icloud.com";
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const getStoredValue = (key, fallback) => {
    try {
        return localStorage.getItem(key) || fallback;
    } catch {
        return fallback;
    }
};

const setStoredValue = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // The setting still applies for the current visit.
    }
};

let storedTheme = getStoredValue("theme", preferredTheme);
let currentLanguage = getStoredValue("language", "ar");

if (!["ar", "en"].includes(currentLanguage)) {
    currentLanguage = "ar";
}

document.documentElement.setAttribute("data-theme", storedTheme);
document.documentElement.lang = currentLanguage;
document.documentElement.dir = currentLanguage === "ar" ? "rtl" : "ltr";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[character]));

const uiText = {
    ar: {
        siteTitle: "MAK Plumbing Solutions | ماك للسباكة والتوزيع",
        siteDescription: "MAK توفر مواسير وقطع ووصلات ومحابس سباكة للمشروعات والتجار في مصر مع طلب سريع عبر واتساب.",
        skip: "تخطي للمحتوى",
        topbar: "تأكيد مخزون سريع للمشروعات والطلبات بالجملة",
        whatsappDirect: "واتساب مباشر",
        nav: ["الرئيسية", "المنتجات", "الأسعار", "عن الشركة", "المشروعات", "أسئلة", "تواصل"],
        quoteLink: "اطلب عرض سعر",
        languageLabel: "Switch to English",
        languageButton: "EN",
        menuOpen: "فتح القائمة",
        menuClose: "إغلاق القائمة",
        themeDark: "تغيير للوضع الداكن",
        themeLight: "تغيير للوضع الفاتح",
        heroEyebrow: "MAK | المصرية للتجارة والتوزيع",
        heroTitle: "مواسير وقطع صحية جاهزة للمشروعات والتجار.",
        heroText: "كتالوج واضح للأسعار والمقاسات، تجهيز سريع للطلبات، ودعم في اختيار المواسير والقطع المناسبة قبل الشراء.",
        heroPrimary: "شوف قائمة الأسعار",
        heroSecondary: "اطلب على واتساب",
        heroProof: ["أسعار منظمة", "مقاسات واضحة", "طلب سريع"],
        heroHighlights: [
            ["توريد سريع", "للمقاولين والمحلات"],
            ["خامات موثوقة", "مواسير وقطع متعددة"],
            ["تجهيز كميات", "حسب المقاس والعدد"]
        ],
        heroCardLabel: "طلبك في خطوة واحدة",
        heroCardTitle: "ابعت المقاس والعدد واحصل على رد سريع",
        heroCardItems: ["مواسير جولد و B ورمادي", "قطع ووصلات صرف", "بولي أخضر ومعزول"],
        heroCardAction: "جهز طلبي",
        statsTitles: ["مواسير", "قطع ووصلات", "بولي PPR", "تأكيد الطلب"],
        stats: ["PVC وB ومقاسات متنوعة", "أكواع وجلب ومحابس", "أخضر ومعزول", "السعر والمخزون قبل الشراء"],
        statsAriaLabel: "فئات المنتجات والخدمة",
        servicesKicker: "المنتجات",
        servicesTitle: "كل احتياجات السباكة في مكان واحد",
        servicesText: "مواسير، قطع، وصلات، محابس، وبولي بروبلين للمشروعات السكنية والتجارية.",
        serviceCards: [
            ["مواسير PVC و B", "مواسير صرف ومياه بمقاسات مختلفة وأسعار واضحة لكل ماسورة.", ["صرف", "مقاسات متعددة", "توريد بالجملة"], "عرض الأسعار"],
            ["بولي بروبلين PPR", "حلول مياه ساخنة وباردة، أخضر ومعزول، مع قطع لحام ومحابس.", ["مياه ساخنة", "مياه باردة", "قطع لحام"], "عرض أسعار البولي"],
            ["قطع ووصلات ومحابس", "أكواع، جلب، مشتركات، طبات، محابس، ولاكور حسب المقاس.", ["وصلات", "مقايسات", "صيانة"], "عرض القطع"]
        ],
        catalogKicker: "قائمة الأسعار",
        catalogTitle: "كل صنف في صفحة لوحده",
        catalogText: "ابحث بالاسم أو المقاس، وافتح تفاصيل أي صنف بصورة ومقاس وسعر ورابط طلب مباشر.",
        productsPageKicker: "المنتجات",
        productsPageTitle: "كل منتجات MAK",
        productsPageText: "كل صنف ظاهر لوحده بالصورة والمقاس والمواصفة والسعر، ومعاه صفحة تفاصيل مستقلة.",
        productsHeroTitle: "منتجات MAK قدامك بالصورة والسعر",
        productsHeroText: "اختار من المواسير، القطع والوصلات، أو البولي. كل صنف له صورة ومقاس وسعر واضح.",
        productsFeatures: [
            ["مواسير", "مواسير جولد وB ورمادي", "مقاسات ومواصفات وأسعار واضحة لكل ماسورة.", "عرض المواسير"],
            ["قطع ووصلات", "أكواع وجلب ومشتركات", "اختار القطعة بالمقاس والصورة قبل ما تطلب.", "عرض القطع"],
            ["بولي", "PPR أخضر ومعزول", "مواسير وقطع لحام بولي بمقاسات وأسعار واضحة.", "عرض البولي"]
        ],
        confirmPrice: "تأكيد السعر على واتساب",
        searchLabel: "بحث",
        searchPlaceholder: "اكتب اسم المنتج أو المقاس مثل 25 أو كوع",
        sortLabel: "ترتيب النتائج",
        sortOptions: { featured: "الترتيب الافتراضي", name: "الاسم من أ إلى ي", low: "السعر من الأقل", high: "السعر من الأعلى" },
        clearFilters: "مسح الفلاتر",
        showMore: "عرض المزيد من المنتجات",
        tabsAriaLabel: "تصفية المنتجات حسب النوع",
        tabs: { all: "الكل", pipes: "مواسير", fittings: "قطع ووصلات", poly: "بولي" },
        catalogCount: (count, total) => `معروض ${count} من ${total} صنف`,
        noResults: "مفيش نتائج مطابقة للبحث",
        details: "تفاصيل",
        order: "اطلب الصنف",
        price: "السعر",
        size: "المقاس",
        spec: "المواصفة",
        type: "النوع",
        finish: "التشطيب",
        unit: "الوحدة",
        category: "التصنيف",
        stockNote: "يفضل تأكيد السعر والمخزون قبل الطلب.",
        egp: "جنيه",
        perPipe: "سعر / ماسورة",
        perPiece: "سعر / قطعة",
        backToCatalog: "رجوع للكتالوج",
        productNotFoundTitle: "الصنف غير موجود",
        productNotFoundText: "ارجع للكتالوج واختار الصنف المطلوب من القائمة.",
        relatedTitle: "أصناف قريبة",
        productRequest: "اطلب الصنف على واتساب",
        stockKicker: "تأكيد سريع",
        stockTitle: "ابعت صورة الصنف أو المقاس قبل الشراء.",
        stockText: "لو مش متأكد من الاسم أو المقاس، ابعت صورة المنتج أو المقاس أو جزء من المقايسة، ونساعدك تحدد البديل المناسب.",
        stockItems: ["اسم الصنف أو صورته", "المقاس والعدد المطلوب", "مكان التسليم أو الاستلام"],
        stockButton: "تأكيد المخزون",
        stockCaption: "الأفضل تأكيد السعر والمخزون قبل تثبيت الطلب.",
        aboutKicker: "عن الشركة",
        aboutTitle: "توريد منظم وخدمة واضحة من أول رسالة لحد التسليم.",
        aboutText: "MAK بتساعد المقاولين والمحلات وأصحاب المشروعات في تجهيز مواسير وقطع السباكة بالمقاسات المناسبة، مع تواصل مباشر لتأكيد السعر والكمية.",
        aboutLink: "تواصل مع الفريق",
        processKicker: "طريقة الطلب",
        processTitle: "من الليستة للطلب في 3 خطوات",
        processText: "اختار الصنف، راجع المقاس والسعر، ثم أرسل الطلب مباشرة على واتساب.",
        processCards: [
            ["01", "حدد المنتج", "اختار من المواسير، القطع، أو البولي من قائمة الأسعار."],
            ["02", "راجع التفاصيل", "كل صنف له صفحة فيها الصورة والمقاس والسعر."],
            ["03", "استلم التأكيد", "الفريق يراجع التوفر والسعر النهائي ويرتب معك الطلب."]
        ],
        projectsKicker: "المشروعات",
        projectsTitle: "توريد للمنازل والمحلات والمقاولات",
        projectsText: "اضغط على أي نوع مشروع لفتح طلب جاهز وتعديله حسب احتياجك.",
        projectCards: [
            ["سكني", "شبكات المنازل", "مياه وصرف وصيانة للشقق والفيلات.", "مواسير وقطع لصيانة أو تأسيس الشقق والفيلات، مع تجهيز المقاسات والكميات المطلوبة.", "أحتاج تجهيز مواد سباكة لشبكة منزلية."],
            ["مقاولات", "توريد للمقاولين", "كميات ومقاسات للمواقع والمشروعات.", "تجهيز طلبات بالجملة من مواسير وقطع ووصلات حسب المقايسة، مع متابعة المقاسات والكميات.", "أحتاج عرض سعر توريد مقاولات."],
            ["تجارة", "طلبات المحلات والصيانة", "قطع سريعة وبدائل حسب المخزون.", "تجهيز قطع ووصلات ومحابس للصيانة اليومية والمحلات، مع بدائل حسب المتوفر.", "أحتاج توريد قطع للمحل أو الصيانة."]
        ],
        faqKicker: "أسئلة مهمة",
        faqTitle: "قبل ما تطلب",
        faqText: "إجابات مختصرة تساعدك تبعت الطلب صح من أول مرة.",
        faqs: [
            ["هل الأسعار نهائية؟", "الأسعار المعروضة من الليستة، ويفضل تأكيد السعر والمخزون على واتساب قبل الطلب."],
            ["ينفع أبعت صورة المنتج بدل الاسم؟", "نعم. ابعت صورة المنتج أو المقاس أو جزء من المقايسة والفريق يساعدك في تحديد الصنف."],
            ["هل فيه طلبات جملة؟", "نعم، يتم تجهيز طلبات الجملة والمقاولات حسب الكمية والمقاسات المطلوبة."],
            ["الشركة فين؟", "الشركة في إيتاي البارود، البحيرة، مع توريد حسب الاتفاق والتوفر."]
        ],
        contactKicker: "تواصل معنا",
        contactTitle: "جاهز تبعت طلبك؟",
        contactText: "اكتب الصنف والمقاس والعدد، أو ابعت صورة المنتج، وهنرد عليك بتأكيد السعر والتوفر.",
        address: ["إيتاي البارود، البحيرة، مصر", "السبت إلى الخميس | 9 صباحا - 4 مساء"],
        callNow: "اتصل الآن",
        quickRequest: "طلب سريع",
        presets: ["مواسير PVC", "بولي PPR", "قطع ومحابس"],
        labels: ["الاسم", "البريد الإلكتروني", "رقم الموبايل", "نوع الطلب", "تفاصيل الطلب"],
        placeholders: ["اسمك", "example@email.com", "01000000000", "اكتب الصنف، المقاس، العدد، ومكان التسليم"],
        selectOptions: ["طلب منزل", "طلب مقاولات", "طلب محل", "صيانة"],
        submit: "حفظ وفتح واتساب",
        submitEmail: "حفظ وفتح الإيميل",
        channelTitle: "اختار وسيلة إرسال الطلب",
        channelHint: "الطلب بيتحفظ الأول، وبعدها تفتح الرسالة وتضغط إرسال.",
        whatsappDraft: "تم تجهيز رسالة واتساب. اضغط إرسال داخل واتساب.",
        emailDraft: "تم تجهيز رسالة الإيميل في تطبيق البريد. اضغط إرسال داخل التطبيق.",
        openSelected: "اضغط زر فتح وسيلة الإرسال لإكمال إرسال الرسالة.",
        saving: "جاري حفظ الطلب…",
        saved: "تم حفظ طلبك بنجاح. رقم الطلب:",
        saveFailed: "لم يتم تأكيد حفظ الطلب. أعد المحاولة أو أرسل التفاصيل عبر واتساب.",
        rateLimited: "وصلت للحد المسموح من الطلبات. حاول بعد 10 دقائق أو تواصل عبر واتساب.",
        contactRequired: "اكتب رقم الموبايل أو البريد الإلكتروني عشان نقدر نرد عليك.",
        catalogLoading: "جاري تحميل المنتجات والأسعار…",
        catalogFailed: "تعذر تحميل الأسعار. أعد المحاولة أو تواصل معنا لتأكيد السعر.",
        retry: "إعادة المحاولة",
        orderEmailSubject: "طلب جديد من موقع MAK",
        openWhatsapp: "فتح واتساب",
        openEmail: "فتح الإيميل",
        orderPanelTitle: "ملخص الطلب",
        orderSummaryEmpty: "طلب جديد جاهز للاستقبال. اكتب التفاصيل وسيظهر الملخص هنا.",
        copyOrder: "نسخ الطلب",
        copiedOrder: "تم نسخ الطلب",
        orderReadyStatus: "تم تجهيز الطلب",
        footerText: "مواسير وقطع صحية للمشروعات والمحلات والمنازل في مصر.",
        quickLinks: "روابط سريعة",
        contactInfo: "بيانات التواصل",
        copyright: "MAK Plumbing Solutions. جميع الحقوق محفوظة.",
        dialogKicker: "توريد مشروع",
        dialogAction: "اطلب هذا التوريد",
        closeDialog: "إغلاق",
        toTop: "العودة للأعلى",
        mobileContact: "تواصل سريع للموبايل",
        contact: "اتصال",
        whatsapp: "واتساب",
        email: "إيميل"
    },
    en: {
        siteTitle: "MAK Plumbing Solutions | Pipes, Fittings, and Project Supply",
        siteDescription: "MAK supplies plumbing pipes, fittings, valves, and PPR products in Egypt with fast WhatsApp ordering.",
        skip: "Skip to content",
        topbar: "Fast stock confirmation for projects and wholesale orders",
        whatsappDirect: "WhatsApp",
        nav: ["Home", "Products", "Prices", "About", "Projects", "FAQ", "Contact"],
        quoteLink: "Request a Quote",
        languageLabel: "Switch to Arabic",
        languageButton: "عربي",
        menuOpen: "Open menu",
        menuClose: "Close menu",
        themeDark: "Switch to dark mode",
        themeLight: "Switch to light mode",
        heroEyebrow: "MAK | Egyptian Trading and Distribution",
        heroTitle: "Plumbing pipes and fittings ready for contractors and traders.",
        heroText: "A clear catalog with prices and sizes, fast order preparation, and support choosing the right pipes and fittings before purchase.",
        heroPrimary: "View Price List",
        heroSecondary: "Order on WhatsApp",
        heroProof: ["Organized prices", "Clear sizes", "Fast ordering"],
        heroHighlights: [
            ["Fast supply", "For contractors and stores"],
            ["Reliable materials", "Multiple pipe and fitting lines"],
            ["Quantity preparation", "By size and count"]
        ],
        heroCardLabel: "Your order in one step",
        heroCardTitle: "Send the size and quantity for a fast reply",
        heroCardItems: ["Gold, B, and grey pipes", "PVC drainage fittings", "Green and insulated PPR"],
        heroCardAction: "Prepare my order",
        statsTitles: ["Pipes", "Fittings", "PPR", "Order check"],
        stats: ["PVC, B, and various sizes", "Elbows, couplings, and valves", "Green and insulated", "Confirm price and availability"],
        statsAriaLabel: "Product categories and service",
        servicesKicker: "Products",
        servicesTitle: "Everything your plumbing order needs in one place",
        servicesText: "Pipes, fittings, valves, and polypropylene products for residential and commercial projects.",
        serviceCards: [
            ["PVC and B Pipes", "Drainage and water pipes in different sizes with clear pricing per pipe.", ["Drainage", "Multiple sizes", "Wholesale supply"], "View prices"],
            ["PPR Polypropylene", "Hot and cold water solutions, green and insulated, with welding fittings and valves.", ["Hot water", "Cold water", "Welding fittings"], "View PPR prices"],
            ["Fittings, Connectors, and Valves", "Elbows, couplings, tees, caps, valves, and unions by size.", ["Fittings", "BOQs", "Maintenance"], "View fittings"]
        ],
        catalogKicker: "Price List",
        catalogTitle: "Every item has its own page",
        catalogText: "Search by name or size, then open any item to see its image, size, price, and direct order link.",
        productsPageKicker: "Products",
        productsPageTitle: "All MAK Products",
        productsPageText: "Every item appears on its own with image, size, specification, price, and an independent detail page.",
        productsHeroTitle: "MAK products, with clear photos and prices",
        productsHeroText: "Browse pipes, fittings, or PPR. Each item has a clear photo, size, and price.",
        productsFeatures: [
            ["Pipes", "Gold, B, and grey pipes", "Clear sizes, specifications, and prices for every pipe.", "View pipes"],
            ["Fittings", "Elbows, couplings, and tees", "Choose a fitting by size and photo before ordering.", "View fittings"],
            ["PPR", "Green and insulated PPR", "PPR pipes and fittings with clear sizes and prices.", "View PPR"]
        ],
        confirmPrice: "Confirm price on WhatsApp",
        searchLabel: "Search",
        searchPlaceholder: "Enter a product name or size, such as 25 or elbow",
        sortLabel: "Sort results",
        sortOptions: { featured: "Recommended order", name: "Name A to Z", low: "Price: low to high", high: "Price: high to low" },
        clearFilters: "Clear filters",
        showMore: "Show more products",
        tabsAriaLabel: "Filter products by type",
        tabs: { all: "All", pipes: "Pipes", fittings: "Fittings", poly: "PPR" },
        catalogCount: (count, total) => `Showing ${count} of ${total} items`,
        noResults: "No matching items found",
        details: "Details",
        order: "Order item",
        price: "Price",
        size: "Size",
        spec: "Specification",
        type: "Type",
        finish: "Finish",
        unit: "Unit",
        category: "Category",
        stockNote: "Please confirm price and stock before ordering.",
        egp: "EGP",
        perPipe: "Price / pipe",
        perPiece: "Price / piece",
        backToCatalog: "Back to catalog",
        productNotFoundTitle: "Item not found",
        productNotFoundText: "Return to the catalog and choose the item you need.",
        relatedTitle: "Related items",
        productRequest: "Order this item on WhatsApp",
        stockKicker: "Fast Confirmation",
        stockTitle: "Send a product photo or size before buying.",
        stockText: "If you are unsure about the item name or size, send a product photo, the size, or part of the BOQ, and we will help identify the right alternative.",
        stockItems: ["Item name or photo", "Required size and quantity", "Delivery or pickup location"],
        stockButton: "Confirm stock",
        stockCaption: "It is better to confirm price and stock before placing the order.",
        aboutKicker: "About",
        aboutTitle: "Organized supply and clear service from first message to delivery.",
        aboutText: "MAK helps contractors, stores, and project owners prepare plumbing pipes and fittings in the right sizes, with direct contact to confirm price and quantity.",
        aboutLink: "Contact the team",
        processKicker: "How to Order",
        processTitle: "From price list to order in 3 steps",
        processText: "Choose the item, review size and price, then send the order directly on WhatsApp.",
        processCards: [
            ["01", "Choose the product", "Select pipes, fittings, or PPR products from the price list."],
            ["02", "Review details", "Every item has a page with image, size, and price."],
            ["03", "Get confirmation", "The team reviews availability and final price, then arranges your order."]
        ],
        projectsKicker: "Projects",
        projectsTitle: "Supply for homes, stores, and contractors",
        projectsText: "Tap any project type to open a ready message and edit it for your order.",
        projectCards: [
            ["Residential", "Home networks", "Water, drainage, and maintenance for apartments and villas.", "Pipes and fittings for maintenance or setup of apartments and villas, with required sizes and quantities.", "I need plumbing materials for a home network."],
            ["Contracting", "Contractor supply", "Quantities and sizes for sites and projects.", "Wholesale orders of pipes, fittings, and connectors according to the BOQ, with size and quantity follow-up.", "I need a contractor supply quote."],
            ["Trade", "Store and maintenance orders", "Fast fittings and alternatives based on stock.", "Fittings, connectors, and valves for daily maintenance and store supply, with alternatives based on availability.", "I need fittings for a store or maintenance order."]
        ],
        faqKicker: "Key Questions",
        faqTitle: "Before You Order",
        faqText: "Short answers that help you send the right order from the first message.",
        faqs: [
            ["Are prices final?", "Prices are shown from the list. Please confirm price and stock on WhatsApp before ordering."],
            ["Can I send a product photo instead of the name?", "Yes. Send the product photo, size, or part of the BOQ and the team will help identify it."],
            ["Do you supply wholesale orders?", "Yes, wholesale and contractor orders are prepared by quantity and required sizes."],
            ["Where is the company located?", "The company is in Itay El Baroud, Beheira, with supply according to agreement and availability."]
        ],
        contactKicker: "Contact Us",
        contactTitle: "Ready to send your order?",
        contactText: "Write the item, size, and quantity, or send a product photo, and we will confirm price and availability.",
        address: ["Itay El Baroud, Beheira, Egypt", "Saturday to Thursday | 9 AM - 4 PM"],
        callNow: "Call now",
        quickRequest: "Quick request",
        presets: ["PVC Pipes", "PPR", "Fittings and valves"],
        labels: ["Name", "Email", "Mobile number", "Order type", "Order details"],
        placeholders: ["Your name", "example@email.com", "01000000000", "Write the item, size, quantity, and delivery location"],
        selectOptions: ["Home order", "Contractor order", "Store order", "Maintenance"],
        submit: "Save and open WhatsApp",
        submitEmail: "Save and open email",
        channelTitle: "Choose how to send your request",
        channelHint: "Your request is saved first. Then review the message and press Send.",
        whatsappDraft: "Your WhatsApp message is ready. Press Send in WhatsApp.",
        emailDraft: "Your email draft is ready in your mail app. Press Send there.",
        openSelected: "Use the Open button to finish sending the message.",
        saving: "Saving your request…",
        saved: "Your request was saved. Order number:",
        saveFailed: "We could not confirm your request was saved. Retry or send the details via WhatsApp.",
        rateLimited: "Too many requests. Try again in 10 minutes or contact us via WhatsApp.",
        contactRequired: "Enter a phone number or email so we can reply.",
        catalogLoading: "Loading products and prices…",
        catalogFailed: "Prices could not be loaded. Retry or contact us to confirm pricing.",
        retry: "Retry",
        orderEmailSubject: "New order from MAK website",
        openWhatsapp: "Open WhatsApp",
        openEmail: "Open email",
        orderPanelTitle: "Order summary",
        orderSummaryEmpty: "New order ready to receive. Add details and the summary will appear here.",
        copyOrder: "Copy order",
        copiedOrder: "Order copied",
        orderReadyStatus: "Order prepared",
        footerText: "Plumbing pipes and fittings for projects, stores, and homes in Egypt.",
        quickLinks: "Quick Links",
        contactInfo: "Contact Info",
        copyright: "MAK Plumbing Solutions. All rights reserved.",
        dialogKicker: "Project Supply",
        dialogAction: "Request this supply",
        closeDialog: "Close",
        toTop: "Back to top",
        mobileContact: "Quick mobile contact",
        contact: "Call",
        whatsapp: "WhatsApp",
        email: "Email"
    }
};

let products = [];
let catalogState = "loading";

const formatPrice = (value, language = currentLanguage) => {
    const locale = language === "ar" ? "ar-EG" : "en-EG";
    return new Intl.NumberFormat(locale, {
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
};

const isGitHubPages = () => window.location.hostname?.endsWith(".github.io") === true;
const productHref = (product) => isGitHubPages()
    ? `product.html?id=${encodeURIComponent(product.id)}`
    : `/product/${encodeURIComponent(product.id)}`;

const productQuote = (product, language = currentLanguage) => {
    const local = product[language];
    const labels = uiText[language];
    const price = `${formatPrice(product.price, language)} ${labels.egp}`;

    if (language === "en") {
        return `Hello MAK, I need to confirm price and stock for this item:\n\nItem: ${local.name}\nSize: ${local.size}\nSpecification: ${local.spec}\nPrice shown: ${price}\nQuantity: \nDelivery location: `;
    }

    return `السلام عليكم، أحتاج تأكيد سعر ومخزون للصنف التالي من MAK:\n\nالصنف: ${local.name}\nالمقاس: ${local.size}\nالمواصفة: ${local.spec}\nالسعر المعروض: ${price}\nالعدد: \nمكان التسليم: `;
};

const orderCodeLine = (orderCode, language = currentLanguage) => {
    if (!orderCode) {
        return "";
    }

    return language === "en"
        ? `Order code: ${orderCode}\n`
        : `رقم الطلب: ${orderCode}\n`;
};

const defaultOrderMessage = (language = currentLanguage, orderCode = "") => language === "en"
    ? `Hello MAK, I need a quote.\n\n${orderCodeLine(orderCode, language)}Order details: `
    : `السلام عليكم، أحتاج عرض سعر من MAK.\n\n${orderCodeLine(orderCode, language)}تفاصيل الطلب: `;

const buildContactOrderMessage = (form, language = currentLanguage, orderCode = "") => {
    if (!form) {
        return defaultOrderMessage(language, orderCode);
    }

    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const projectType = String(formData.get("projectType") || "").trim();
    const message = String(formData.get("message") || "").trim();

    if (![name, email, phone, message].some(Boolean)) {
        return defaultOrderMessage(language, orderCode);
    }

    return language === "en"
        ? `Hello MAK, I need a quote.\n\n${orderCodeLine(orderCode, language)}Name: ${name || "Not added"}\nEmail: ${email || "Not added"}\nMobile: ${phone || "Not added"}\nOrder type: ${projectType || "Not selected"}\nOrder details: ${message || "Not added"}`
        : `السلام عليكم، أحتاج عرض سعر من MAK.\n\n${orderCodeLine(orderCode, language)}الاسم: ${name || "غير مضاف"}\nالإيميل: ${email || "غير مضاف"}\nالموبايل: ${phone || "غير مضاف"}\nنوع الطلب: ${projectType || "غير محدد"}\nتفاصيل الطلب: ${message || "غير مضافة"}`;
};

const whatsappHref = (message) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

const mailtoHref = (subject, message) => `mailto:${ORDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

const selectedOrderChannel = (form) => form?.querySelector('[name="deliveryChannel"]:checked')?.value === "email" ? "email" : "whatsapp";

const orderChannelHref = (channel, message, language = currentLanguage) => channel === "email"
    ? mailtoHref(uiText[language].orderEmailSubject, message)
    : whatsappHref(message);

const setOrderDeliveryLinks = (message, language = currentLanguage) => {
    const channel = selectedOrderChannel(document.querySelector(".contact-form"));
    const ui = uiText[language];
    document.querySelectorAll("[data-order-send]").forEach((link) => {
        link.href = orderChannelHref(channel, message, language);
        link.target = channel === "email" ? "_self" : "_blank";
        link.textContent = channel === "email" ? ui.openEmail : ui.openWhatsapp;
    });
    setText(".contact-form .button[type='submit']", channel === "email" ? ui.submitEmail : ui.submit);
};

const setText = (selector, value) => {
    document.querySelectorAll(selector).forEach((element) => {
        element.textContent = value;
    });
};

const setAttribute = (selector, attribute, value) => {
    document.querySelectorAll(selector).forEach((element) => {
        element.setAttribute(attribute, value);
    });
};

const setListText = (selector, values, childSelector = null) => {
    document.querySelectorAll(selector).forEach((element, index) => {
        const value = values[index];
        if (!value) {
            return;
        }

        const target = childSelector ? element.querySelector(childSelector) : element;
        if (target) {
            target.textContent = value;
        }
    });
};

const setTextWithin = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
};

const setAttributeWithin = (root, selector, attribute, value) => {
    const element = root.querySelector(selector);
    if (element) element.setAttribute(attribute, value);
};

const applyStaticLanguage = (language) => {
    const ui = uiText[language];
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.body?.classList.toggle("is-ltr", language === "en");

    if (!document.body?.classList.contains("product-page")) {
        document.title = ui.siteTitle;
        setAttribute('meta[name="description"]', "content", ui.siteDescription);
        setAttribute('meta[property="og:title"]', "content", ui.siteTitle);
        setAttribute('meta[property="og:description"]', "content", ui.siteDescription);
        setAttribute('meta[name="twitter:title"]', "content", ui.siteTitle);
        setAttribute('meta[name="twitter:description"]', "content", ui.siteDescription);
    }

    setText(".skip-link", ui.skip);
    setText(".topbar-inner > span", ui.topbar);
    setText('.topbar-links a[href^="https://wa.me"]', ui.whatsappDirect);
    setListText(".nav-links a", ui.nav);
    setText(".quote-link", ui.quoteLink);
    setText(".language-toggle", ui.languageButton);
    setAttribute(".language-toggle", "aria-label", ui.languageLabel);
    setText(".hero .eyebrow", ui.heroEyebrow);
    setText("#hero-title", ui.heroTitle);
    setText(".hero-copy > p:not(.eyebrow)", ui.heroText);
    setText(".hero-actions .button-primary", ui.heroPrimary);
    setText(".hero-actions .button-secondary", ui.heroSecondary);
    setListText(".hero-proof span", ui.heroProof);

    document.querySelectorAll(".hero-highlights li").forEach((item, index) => {
        const pair = ui.heroHighlights[index];
        if (!pair) {
            return;
        }
        item.querySelector("strong").textContent = pair[0];
        item.querySelector("span").textContent = pair[1];
    });

    setAttribute(".stats", "aria-label", ui.statsAriaLabel);
    setListText(".stats .stat strong", ui.statsTitles);
    setListText(".stats .stat span", ui.stats);

    setText(".hero-card-label", ui.heroCardLabel);
    setText(".hero-card strong", ui.heroCardTitle);
    setListText(".hero-card li", ui.heroCardItems);
    setText(".hero-card a", ui.heroCardAction);
    setText(".services .section-kicker", ui.servicesKicker);
    setText(".services .section-heading h2", ui.servicesTitle);
    setText(".services .section-heading > p:not(.section-kicker)", ui.servicesText);

    document.querySelectorAll(".services .product-card").forEach((card, index) => {
        const item = ui.serviceCards[index];
        if (!item) {
            return;
        }
        card.querySelector("h3").textContent = item[0];
        card.querySelector(".card-body > p").textContent = item[1];
        card.querySelectorAll(".product-tags li").forEach((tag, tagIndex) => {
            tag.textContent = item[2][tagIndex] || tag.textContent;
        });
        card.querySelector("a").textContent = item[3];
    });

    setText(".pricing .section-kicker", ui.catalogKicker);
    setText(".catalog-head h2", ui.catalogTitle);
    setText(".catalog-head p:not(.section-kicker)", ui.catalogText);

    if (document.body?.classList.contains("products-page")) {
        document.title = `${ui.productsPageTitle} | MAK Plumbing Solutions`;
        setText(".pricing .section-kicker", ui.productsPageKicker);
        setText(".catalog-head h1", ui.productsPageTitle);
        setText(".catalog-head p:not(.section-kicker)", ui.productsPageText);
    }

    setText(".catalog-head .button", ui.confirmPrice);
    setText(".catalog-search span", ui.searchLabel);
    setAttribute("#catalog-search", "placeholder", ui.searchPlaceholder);
    setText(".catalog-sort span", ui.sortLabel);
    setText('.catalog-sort option[value="featured"]', ui.sortOptions.featured);
    setText('.catalog-sort option[value="name"]', ui.sortOptions.name);
    setText('.catalog-sort option[value="low"]', ui.sortOptions.low);
    setText('.catalog-sort option[value="high"]', ui.sortOptions.high);
    setText(".catalog-reset", ui.clearFilters);
    setAttribute(".catalog-tabs", "aria-label", ui.tabsAriaLabel);
    setText(".products-showcase-copy .section-kicker", ui.productsPageKicker);
    setText("#products-showcase-title", ui.productsHeroTitle);
    setText(".products-showcase-copy > p:not(.section-kicker)", ui.productsHeroText);
    document.querySelectorAll(".products-feature-card").forEach((card, index) => {
        const feature = ui.productsFeatures[index];
        if (!feature) return;
        const [category, title, description, action] = feature;
        setTextWithin(card, ".products-feature-card > div > span", category);
        setTextWithin(card, "h2", title);
        setTextWithin(card, "p", description);
        setTextWithin(card, "a", action);
        setAttributeWithin(card, "img", "alt", title);
    });
    setText('[data-catalog-tab="all"]', ui.tabs.all);
    setText('[data-catalog-tab="pipes"]', ui.tabs.pipes);
    setText('[data-catalog-tab="fittings"]', ui.tabs.fittings);
    setText('[data-catalog-tab="poly"]', ui.tabs.poly);

    setText(".stock-check .section-kicker", ui.stockKicker);
    setText("#stock-check-title", ui.stockTitle);
    setText(".stock-content > p:not(.section-kicker)", ui.stockText);
    setListText(".stock-list li", ui.stockItems);
    setText(".stock-content .button", ui.stockButton);
    setText(".stock-media figcaption", ui.stockCaption);
    setText(".about .section-kicker", ui.aboutKicker);
    setText(".about .section-content h2", ui.aboutTitle);
    setText(".about .section-content > p:not(.section-kicker)", ui.aboutText);
    setText(".about .text-link", ui.aboutLink);
    setText(".process .section-kicker", ui.processKicker);
    setText("#process-title", ui.processTitle);
    setText(".process .section-heading > p:not(.section-kicker)", ui.processText);

    document.querySelectorAll(".process-card").forEach((card, index) => {
        const item = ui.processCards[index];
        if (!item) {
            return;
        }
        card.querySelector("span").textContent = item[0];
        card.querySelector("h3").textContent = item[1];
        card.querySelector("p").textContent = item[2];
    });

    setText(".projects .section-kicker", ui.projectsKicker);
    setText(".projects .section-heading h2", ui.projectsTitle);
    setText(".projects .section-heading > p:not(.section-kicker)", ui.projectsText);

    document.querySelectorAll(".project-trigger").forEach((button, index) => {
        const item = ui.projectCards[index];
        if (!item) {
            return;
        }
        button.querySelector("span").textContent = item[0];
        button.querySelector("h3").textContent = item[1];
        button.querySelector("p").textContent = item[2];
        button.dataset.projectTitle = item[1];
        button.dataset.projectText = item[3];
        button.dataset.projectQuote = item[4];
    });

    setText(".faq .section-kicker", ui.faqKicker);
    setText(".faq .section-heading h2", ui.faqTitle);
    setText(".faq .section-heading > p:not(.section-kicker)", ui.faqText);

    document.querySelectorAll(".faq-list details").forEach((item, index) => {
        const faq = ui.faqs[index];
        if (!faq) {
            return;
        }
        item.querySelector("summary").textContent = faq[0];
        item.querySelector("p").textContent = faq[1];
    });

    setText(".contact-details .section-kicker", ui.contactKicker);
    setText(".contact-details h2", ui.contactTitle);
    setText(".contact-details > p:not(.section-kicker)", ui.contactText);
    setListText(".contact-details address span", ui.address);
    setText(".contact-actions .button-primary", ui.whatsappDirect);
    setText(".contact-actions .button-outline", ui.callNow);
    setText(".quote-presets legend", ui.quickRequest);
    setListText(".quote-presets button", ui.presets);
    setListText(".contact-form label span", ui.labels);

    const formInputs = document.querySelectorAll(".contact-form input, .contact-form textarea");
    [ui.placeholders[0], ui.placeholders[1], ui.placeholders[2], ui.placeholders[3]].forEach((placeholder, index) => {
        formInputs[index]?.setAttribute("placeholder", placeholder);
    });

    document.querySelectorAll(".contact-form select option").forEach((option, index) => {
        option.textContent = ui.selectOptions[index] || option.textContent;
        option.value = ui.selectOptions[index] || option.value;
    });

    setText(".contact-form .button[type='submit']", ui.submit);
    setText("[data-channel-title]", ui.channelTitle);
    setText("[data-channel-whatsapp]", ui.whatsapp);
    setText("[data-channel-email]", ui.email);
    setText("[data-channel-hint]", ui.channelHint);
    setText("[data-order-panel-title]", ui.orderPanelTitle);
    setText("[data-copy-order]", ui.copyOrder);
    setText(".site-footer .footer-container > div:first-child p", ui.footerText);
    setText(".site-footer .footer-container > div:nth-child(2) h3", ui.quickLinks);
    setText(".site-footer .footer-container > div:nth-child(3) h3", ui.contactInfo);
    setListText(".site-footer .footer-container > div:nth-child(2) a", [ui.nav[0], ui.nav[1], ui.nav[2], ui.nav[4], ui.nav[5], ui.nav[6]]);
    setText(".site-footer .footer-container > div:nth-child(3) p", ui.address[0]);
    setText(".site-footer .footer-container > div:nth-child(3) small", ui.address[1]);
    setText(".social-links a:nth-child(1)", ui.whatsapp);
    setText(".social-links a:nth-child(2)", ui.contact);
    setText(".social-links a:nth-child(3)", ui.email);
    setText(".copyright", `© ${new Date().getFullYear()} ${ui.copyright}`);
    setText(".dialog-body .section-kicker", ui.dialogKicker);
    setText(".dialog-body .button", ui.dialogAction);
    setText(".dialog-close", ui.closeDialog);
    setAttribute(".dialog-close", "aria-label", ui.closeDialog);
    setAttribute(".to-top", "aria-label", ui.toTop);
    setText(".floating-whatsapp", ui.whatsapp);
    setAttribute(".floating-whatsapp", "aria-label", ui.whatsappDirect);
    setAttribute(".mobile-contact-bar", "aria-label", ui.mobileContact);
    setText(".mobile-contact-bar a:nth-child(1)", ui.contact);
    setText(".mobile-contact-bar a:nth-child(2)", ui.whatsapp);
};

let catalogCanManage=false;
const productManagementButton=product=>catalogCanManage?`<button class="button button-outline catalog-manage-product" type="button" data-manage-product="${escapeHtml(product.id)}">${currentLanguage==='en'?'Edit / delete product':'تعديل / حذف المنتج'}</button>`:'';

const renderProductCard = (product, language = currentLanguage) => {
    const ui = uiText[language];
    const local = product[language];
    const price = `${formatPrice(product.price, language)} ${ui.egp}`;
    const finish = local.finish ? `
        <div>
            <dt>${escapeHtml(ui.finish)}</dt>
            <dd>${escapeHtml(local.finish)}</dd>
        </div>` : "";
    const hasImage = Boolean(product.image);
    const mediaImage = hasImage
        ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(local.name)}" loading="lazy" decoding="async">`
        : "";
    const mediaClass = hasImage ? "product-item-media has-product-image" : "product-item-media";
    const placeholder = `<div class="product-image-placeholder" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M8 14h32v24H8zM13 14V8h22v6m-11 6v12m-6-6h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="26" r="3" fill="currentColor"/></svg><span>${currentLanguage === "ar" ? "صورة المنتج" : "Product photo"}</span></div>`;

    return `
        <article class="catalog-card product-item-card" data-category="${escapeHtml(product.category)}" data-search="${escapeHtml(product.search)}" data-price="${escapeHtml(product.price)}" data-sort-name="${escapeHtml(local.name)}">
            <a class="${mediaClass}" href="${escapeHtml(productHref(product))}" aria-label="${escapeHtml(ui.details)} ${escapeHtml(local.name)}">
                ${placeholder}
                ${mediaImage}
                <span>${escapeHtml(local.category)}</span>
            </a>
            <div class="catalog-card-body product-item-body">
                <div class="catalog-card-title product-item-title">
                    <h3>${escapeHtml(local.name)}</h3>
                    <small>${escapeHtml(local.unit === "ماسورة" || local.unit === "pipe" ? ui.perPipe : ui.perPiece)}</small>
                </div>
                <dl class="product-mini-specs">
                    <div>
                        <dt>${escapeHtml(ui.size)}</dt>
                        <dd>${escapeHtml(local.size)}</dd>
                    </div>
                    <div>
                        <dt>${escapeHtml(ui.spec)}</dt>
                        <dd>${escapeHtml(local.spec)}</dd>
                    </div>
                    ${finish}
                </dl>
                <div class="product-price-row">
                    <span>${escapeHtml(ui.price)}</span>
                    <strong>${escapeHtml(price)}</strong>
                </div>
                <div class="product-actions">
                    <a class="button button-outline" href="${escapeHtml(productHref(product))}">${escapeHtml(ui.details)}</a>
                    <button class="catalog-order" type="button" data-product-id="${escapeHtml(product.id)}" data-quote="${escapeHtml(productQuote(product, language))}">${escapeHtml(ui.order)}</button>
                </div>
                ${productManagementButton(product)}
            </div>
        </article>`;
};

const renderCatalog = () => {
    const catalogGrid = document.getElementById("catalog-grid");
    if (!catalogGrid) {
        return;
    }

    if (catalogState === "ready") return;
    const ui = uiText[currentLanguage];
    catalogGrid.setAttribute?.("aria-busy", String(catalogState === "loading"));
    catalogGrid.innerHTML = `<p role="status">${escapeHtml(catalogState === "loading" ? ui.catalogLoading : ui.catalogFailed)}</p>${catalogState === "error" ? `<button class="button button-outline" type="button" data-retry-catalog>${escapeHtml(ui.retry)}</button>` : ""}`;
};

document.addEventListener("error", (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.matches(".product-item-media.has-product-image > img")) {
        image.parentElement.classList.add("image-unavailable");
        image.remove();
    }
}, true);

const normalizeCatalogSearch = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const getProductFromUrl = () => {
    const pathMatch = window.location.pathname.match(/\/product\/([^/]+)/);
    const queryId = new URLSearchParams(window.location.search).get("id");
    const id = pathMatch ? decodeURIComponent(pathMatch[1]) : queryId;
    return products.find((product) => product.id === id);
};

const renderProductDetail = () => {
    const container = document.getElementById("product-detail");
    if (!container) {
        return;
    }

    const ui = uiText[currentLanguage];
    if (catalogState !== "ready") {
        container.innerHTML = `<p role="status">${escapeHtml(catalogState === "loading" ? ui.catalogLoading : ui.catalogFailed)}</p>${catalogState === "error" ? `<button class="button button-outline" type="button" data-retry-catalog>${escapeHtml(ui.retry)}</button>` : ""}`;
        return;
    }
    const product = getProductFromUrl();

    if (!product) {
        document.title = `${ui.productNotFoundTitle} | MAK Plumbing Solutions`;
        container.innerHTML = `
            <div class="product-detail-shell product-not-found">
                <a class="back-link" href="/#pricing">${escapeHtml(ui.backToCatalog)}</a>
                <h1>${escapeHtml(ui.productNotFoundTitle)}</h1>
                <p>${escapeHtml(ui.productNotFoundText)}</p>
            </div>`;
        return;
    }

    const local = product[currentLanguage];
    const price = `${formatPrice(product.price, currentLanguage)} ${ui.egp}`;
    const related = products
        .filter((item) => item.category === product.category && item.id !== product.id)
        .slice(0, 3);

    document.title = `${local.name} | MAK Plumbing Solutions`;
    setAttribute('meta[name="description"]', "content", local.description);
    setAttribute('meta[property="og:title"]', "content", `${local.name} | MAK`);
    setAttribute('meta[property="og:description"]', "content", local.description);
    if (product.image) setAttribute('meta[property="og:image"]', "content", product.image);
    setAttribute('meta[name="twitter:title"]', "content", `${local.name} | MAK`);
    setAttribute('meta[name="twitter:description"]', "content", local.description);

    const finishRow = local.finish ? `
        <div>
            <dt>${escapeHtml(ui.finish)}</dt>
            <dd>${escapeHtml(local.finish)}</dd>
        </div>` : "";
    const detailMedia = product.image ? `
                <figure class="product-detail-media">
                    <img src="${escapeHtml(product.image)}" alt="${escapeHtml(local.name)}">
                    <figcaption>${escapeHtml(ui.stockNote)}</figcaption>
                </figure>` : "";
    const detailGridClass = product.image
        ? "product-detail-grid"
        : "product-detail-grid product-detail-grid-no-image";

    container.innerHTML = `
        <div class="product-detail-shell">
            <a class="back-link" href="/#pricing">${escapeHtml(ui.backToCatalog)}</a>
            <div class="${detailGridClass}">
                ${detailMedia}
                <article class="product-detail-info">
                    <p class="section-kicker">${escapeHtml(local.category)}</p>
                    <h1>${escapeHtml(local.name)}</h1>
                    <p>${escapeHtml(local.description)}</p>
                    <dl class="product-detail-specs">
                        <div>
                            <dt>${escapeHtml(ui.size)}</dt>
                            <dd>${escapeHtml(local.size)}</dd>
                        </div>
                        <div>
                            <dt>${escapeHtml(ui.spec)}</dt>
                            <dd>${escapeHtml(local.spec)}</dd>
                        </div>
                        ${finishRow}
                        <div>
                            <dt>${escapeHtml(ui.unit)}</dt>
                            <dd>${escapeHtml(local.unit)}</dd>
                        </div>
                    </dl>
                    <div class="product-detail-price">
                        <span>${escapeHtml(ui.price)}</span>
                        <strong>${escapeHtml(price)}</strong>
                    </div>
                    ${productManagementButton(product)}
                    <div class="product-detail-actions">
                        <button class="button button-primary" type="button" data-product-id="${escapeHtml(product.id)}" data-direct-order="${escapeHtml(productQuote(product, currentLanguage))}">${escapeHtml(ui.productRequest)}</button>
                        <a class="button button-outline" href="/#pricing">${escapeHtml(ui.backToCatalog)}</a>
                    </div>
                </article>
            </div>
            <section class="related-products" aria-labelledby="related-products-title">
                <h2 id="related-products-title">${escapeHtml(ui.relatedTitle)}</h2>
                <div class="catalog-grid related-products-grid">
                    ${related.map((item) => renderProductCard(item)).join("")}
                </div>
            </section>
        </div>`;
};

document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".site-header");
    const progressBar = document.querySelector(".scroll-progress");
    const menuButton = document.querySelector(".menu-toggle");
    const navPanel = document.querySelector(".nav-panel");
    const primaryNavLinks = document.querySelectorAll(".nav-links a");
    const internalLinks = document.querySelectorAll('a[href^="#"]');
    const projectTriggers = document.querySelectorAll(".project-trigger");
    const projectDialog = document.querySelector(".project-dialog");
    const projectDialogImage = projectDialog?.querySelector("img");
    const projectDialogTitle = document.getElementById("project-dialog-title");
    const projectDialogText = document.getElementById("project-dialog-text");
    const projectDialogQuote = projectDialog?.querySelector("[data-dialog-quote]");
    const projectDialogClose = projectDialog?.querySelector(".dialog-close");
    const faqItems = document.querySelectorAll(".faq-list details");
    const toTopButton = document.querySelector(".to-top");
    const floatingWhatsapp = document.querySelector(".floating-whatsapp");
    const animatedItems = document.querySelectorAll("[data-animate]");
    const counters = document.querySelectorAll("[data-counter]");
    const contactForm = document.querySelector(".contact-form");
    const formStatus = document.querySelector(".form-status");
    const deliveryActions = document.querySelector(".order-delivery-actions");
    const orderCodeNode = document.querySelector("[data-order-code]");
    const orderSummaryNode = document.querySelector("[data-order-summary]");
    const themeToggle = document.getElementById("theme-toggle");
    const languageToggles = document.querySelectorAll(".language-toggle");
    const catalogTabs = document.querySelectorAll("[data-catalog-tab]");
    const catalogSearch = document.getElementById("catalog-search");
    const catalogToolbar = catalogSearch?.closest?.(".catalog-toolbar");
    let catalogSort = document.getElementById("catalog-sort");
    let catalogReset = document.querySelector(".catalog-reset");
    const catalogCount = document.getElementById("catalog-count");
    const catalogGrid = document.getElementById("catalog-grid");
    const catalogPageSize = 24;
    let visibleCatalogLimit = catalogPageSize;
    let activeSortOrder = "featured";

    if (catalogToolbar && !catalogSort) {
        const sortLabel = document.createElement("label");
        sortLabel.className = "catalog-sort";
        sortLabel.htmlFor = "catalog-sort";
        sortLabel.innerHTML = '<span></span><select id="catalog-sort" aria-controls="catalog-grid"><option value="featured"></option><option value="name"></option><option value="low"></option><option value="high"></option></select>';
        const searchLabel = catalogToolbar.querySelector(".catalog-search");
        searchLabel?.insertAdjacentElement("afterend", sortLabel);
        catalogSort = sortLabel.querySelector("select");
    }

    const catalogTabGroup = catalogToolbar?.querySelector(".catalog-tabs");
    if (catalogTabGroup) {
        catalogTabGroup.setAttribute("role", "group");
        if (!catalogReset) {
            catalogReset = document.createElement("button");
            catalogReset.className = "catalog-reset";
            catalogReset.type = "button";
            catalogReset.setAttribute("aria-controls", "catalog-grid");
            catalogTabGroup.append(catalogReset);
        }
    }
    const yearNode = document.getElementById("year");
    let activeCatalogTab = "all";
    let currentOrderCode = "";
    let currentOrderMessage = "";
    let saving = false;
    let pendingRequest = null;
    let selectedProductId = '';
    let confirmedItems = [];
    let selectionInitialized = false;
    let catalogLoaded = false;
    let catalogEtag = '';
    let catalogTimer = null;
    let catalogController = null;
    let catalogRefreshPending=false;
    let catalogManager=null;
    let catalogFailures = 0;

    const selectedItems = () => selectedProductId ? [{productId:selectedProductId,quantity:Number(document.getElementById('selected-quantity')?.value || 1)}] : [];
    const storedPrices = (items,language=currentLanguage) => items.length ? '\n\n'+(language==='ar'?'أسعار المنتجات المحفوظة وقت إنشاء الطلب:':'Product prices saved when this order was created:')+'\n'+items.map(item=>`${language==='ar'?item.name:item.nameEn} — ${item.quantity} × ${formatPrice(item.unitPrice,language)} ${uiText[language].egp} = ${formatPrice(item.total,language)} ${uiText[language].egp}`).join('\n') : '';
    const syncSelectedProduct = () => {
        const panel=document.getElementById('selected-product');
        if(!panel)return;
        panel.hidden=!selectedProductId;
        const product=products.find(p=>p.id===selectedProductId);
        const label=document.getElementById('selected-product-name');
        if(label)label.textContent=product?`${product[currentLanguage].name} — ${formatPrice(product.price)} ${uiText[currentLanguage].egp}`:currentLanguage==='ar'?'المنتج لم يعد متاحًا. اختر منتجًا آخر.':'This product is no longer available. Choose another product.';
        const quantityLabel=document.getElementById('selected-quantity-label');
        if(quantityLabel)quantityLabel.textContent=currentLanguage==='ar'?'الكمية':'Quantity';
        const clear=document.getElementById('clear-selected-product');
        if(clear)clear.textContent=currentLanguage==='ar'?'إلغاء اختيار المنتج':'Clear product selection';
    };

    const updateThemeControl = () => {
        const theme = document.documentElement.getAttribute("data-theme");
        const ui = uiText[currentLanguage];
        themeToggle?.setAttribute("aria-label", theme === "dark" ? ui.themeLight : ui.themeDark);
    };

    const filterCatalog = () => {
        if (!catalogGrid || catalogState !== "ready") return;
        const query = normalizeCatalogSearch(catalogSearch?.value || "");
        const ui = uiText[currentLanguage];
        const matches = products.filter((product) => {
            const categoryMatches = activeCatalogTab === "all" || product.category === activeCatalogTab;
            const haystack = normalizeCatalogSearch([product.search, ...Object.values(product.ar || {}), ...Object.values(product.en || {})].join(" "));
            return categoryMatches && (!query || haystack.includes(query));
        });

        const collator = new Intl.Collator(currentLanguage, { numeric: true, sensitivity: "base" });
        const ordered = [...matches];
        if (activeSortOrder === "name") ordered.sort((a, b) => collator.compare(a[currentLanguage].name, b[currentLanguage].name));
        if (activeSortOrder === "low") ordered.sort((a, b) => a.price - b.price || collator.compare(a[currentLanguage].name, b[currentLanguage].name));
        if (activeSortOrder === "high") ordered.sort((a, b) => b.price - a.price || collator.compare(a[currentLanguage].name, b[currentLanguage].name));

        const visible = ordered.slice(0, visibleCatalogLimit);
        const cards = visible.map((product) => renderProductCard(product)).join("");
        const showMore = ordered.length > visible.length
            ? `<div class="catalog-more-wrap"><button class="button button-outline catalog-load-more" type="button" data-catalog-more aria-controls="catalog-grid">${escapeHtml(ui.showMore)}</button></div>`
            : "";
        const emptyState = `<div class="catalog-empty-state" role="status"><span aria-hidden="true">⌕</span><strong>${escapeHtml(ui.noResults)}</strong><p>${escapeHtml(currentLanguage === "ar" ? "جرّب اسمًا أو مقاسًا مختلفًا، أو امسح الفلاتر." : "Try another name or size, or clear the filters.")}</p></div>`;

        catalogGrid.setAttribute?.("aria-busy", "false");
        catalogGrid.innerHTML = visible.length ? `${cards}${showMore}` : emptyState;
        catalogTabs.forEach((tab) => {
            const isActive = (tab.dataset.catalogTab || "all") === activeCatalogTab;
            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-pressed", String(isActive));
        });
        if (catalogCount) {
            catalogCount.textContent = matches.length ? ui.catalogCount(visible.length, matches.length) : ui.noResults;
        }
    };

    const setMenuState = (isOpen) => {
        const ui = uiText[currentLanguage];
        menuButton?.classList.toggle("is-open", isOpen);
        navPanel?.classList.toggle("is-open", isOpen);
        document.body.classList.toggle("menu-open", isOpen);
        menuButton?.setAttribute("aria-expanded", String(isOpen));
        menuButton?.setAttribute("aria-label", isOpen ? ui.menuClose : ui.menuOpen);
    };

    const closeMenu = () => setMenuState(false);

    const copyText = async (text) => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    };

    const refreshOrderDeliveryLinks = () => {
        const ui = uiText[currentLanguage];
        currentOrderMessage = buildContactOrderMessage(contactForm, currentLanguage, currentOrderCode);
        if(currentOrderCode)currentOrderMessage+=storedPrices(confirmedItems);
        setOrderDeliveryLinks(currentOrderMessage, currentLanguage);

        if (orderCodeNode) {
            orderCodeNode.textContent = currentOrderCode;
        }

        if (orderSummaryNode) {
            orderSummaryNode.textContent = currentOrderMessage || ui.orderSummaryEmpty;
        }
    };

    const fillQuoteMessage = (quoteText, selectedButton) => {
        selectedProductId = selectedButton?.dataset?.productId || '';
        confirmedItems = [];
        const quantity=document.getElementById('selected-quantity');if(quantity)quantity.value='1';
        syncSelectedProduct();
        const messageField = contactForm?.querySelector('textarea[name="message"]');

        if (messageField && quoteText) {
            currentOrderCode = "";
            if (formStatus) formStatus.textContent = "";
            messageField.value = quoteText;
            try {
                messageField.focus({ preventScroll: true });
            } catch {
                messageField.focus();
            }
        }

        document.querySelectorAll("[data-quote]").forEach((item) => item.classList.remove("is-selected"));

        if (selectedButton) {
            selectedButton.classList.add("is-selected");
        }

        refreshOrderDeliveryLinks();
    };

    const refreshLanguage = () => {
        applyStaticLanguage(currentLanguage);
        catalogManager?.labels();
        renderCatalog();
        renderProductDetail();
        updateThemeControl();
        filterCatalog();
        refreshOrderDeliveryLinks();
        syncSelectedProduct();
        closeMenu();
    };

    if (yearNode) {
        yearNode.textContent = new Date().getFullYear();
    }

    refreshLanguage();

    const loadCatalog = async () => {
        if(document.hidden)return;
        if(catalogController){catalogRefreshPending=true;return;}
        clearTimeout(catalogTimer);
        const controller=new AbortController();catalogController=controller;
        const timeout=setTimeout(()=>controller.abort(),15000);
        if(!catalogLoaded){catalogState='loading';renderCatalog();renderProductDetail();}
        try {
            let catalog;
            let response;
            try {
                response = await fetch("/api/products", { cache:'no-store',headers:catalogEtag?{'If-None-Match':catalogEtag}:{},signal:controller.signal });
                if(response.status===304 && catalogLoaded){catalogManager?.onCatalog(products);catalogFailures=0;const status=document.getElementById('catalog-sync-status');if(status)status.textContent='';return;}
                if (!response.ok) throw new Error("Catalog unavailable");
                catalog = await response.json();
            } catch(error) {
                if(!isGitHubPages())throw error;
                const catalogUrl = new URL("data/catalog.json",window.location.href).href;
                response = await fetch(catalogUrl, { cache:'no-store', signal:controller.signal });
                if (!response.ok) throw new Error("Static catalog unavailable");
                catalog = await response.json();
            }
            if (!Array.isArray(catalog.products) || catalog.currency !== "EGP") throw new Error("Invalid catalog");
            const ids = new Set();
            catalog.products.forEach((product) => {
                if (!product.id || ids.has(product.id) || !Number.isFinite(product.price) || product.price < 0 || !product.ar?.name || !product.en?.name) throw new Error("Invalid product");
                ids.add(product.id);
            });
            products = catalog.products.map((product) => ({ ...product, search: [product.id, product.category, ...Object.values(product.ar), ...Object.values(product.en)].join(" ").toLowerCase() }));
            catalogManager?.onCatalog(products);
            catalogState = "ready";
            catalogLoaded=true;catalogFailures=0;catalogEtag=response.headers?.get('ETag') || '';
            const status=document.getElementById('catalog-sync-status');if(status)status.textContent='';
            const selectedId = new URLSearchParams(window.location.search).get("product");
            const selected = products.find((product) => product.id === selectedId);
            if (!selectionInitialized && selected && contactForm && !contactForm.querySelector('[name="message"]').value.trim()) {
                fillQuoteMessage(productQuote(selected),{dataset:{productId:selected.id}});
            }
            selectionInitialized=true;
        } catch {
            if(controller.signal.aborted && document.hidden)return;
            catalogFailures++;
            if(!catalogLoaded){products=[];catalogState='error';}
            const status=document.getElementById('catalog-sync-status');
            if(status)status.textContent=currentLanguage==='ar'?'تعذّر تحديث الأسعار. آخر بيانات معروضة قديمة؛ جاري إعادة المحاولة.':'Prices could not be refreshed. The displayed data may be outdated; retrying.';
        } finally {
            clearTimeout(timeout);catalogController=null;
            if(!document.hidden){catalogTimer=setTimeout(loadCatalog,catalogRefreshPending?0:Math.min(120000,30000*2**Math.min(catalogFailures,2)));catalogRefreshPending=false;}
        }
        renderCatalog();
        renderProductDetail();
        filterCatalog();
        syncSelectedProduct();
    };

    catalogManager=window.MakCatalogManager?.start({
        getLanguage:()=>currentLanguage,
        onAuthorityChange(value){catalogCanManage=value;renderCatalog();renderProductDetail();filterCatalog();},
        refresh(){catalogEtag='';if(catalogController)catalogRefreshPending=true;else if(!document.hidden)void loadCatalog();}
    });

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-retry-catalog]") && catalogState !== "loading") void loadCatalog();
    });
    void loadCatalog();
    document.addEventListener('visibilitychange',()=>{
        clearTimeout(catalogTimer);
        if(document.hidden)catalogController?.abort();else void loadCatalog();
    });
    window.addEventListener('online',()=>{if(!document.hidden)void loadCatalog();});
    document.getElementById('selected-quantity')?.addEventListener('input',()=>{currentOrderCode='';confirmedItems=[];if(deliveryActions)deliveryActions.hidden=true;refreshOrderDeliveryLinks();});
    document.getElementById('clear-selected-product')?.addEventListener('click',()=>{selectedProductId='';currentOrderCode='';confirmedItems=[];syncSelectedProduct();refreshOrderDeliveryLinks();});

    languageToggles.forEach((toggle) => toggle.addEventListener("click", () => {
        currentLanguage = currentLanguage === "ar" ? "en" : "ar";
        setStoredValue("language", currentLanguage);
        refreshLanguage();
    }));

    const invalidateReceipt = (event) => {
        if (event?.target?.name === "deliveryChannel") {
            refreshOrderDeliveryLinks();
            return;
        }
        currentOrderCode = "";
        if (deliveryActions) deliveryActions.hidden = true;
        if (formStatus) formStatus.textContent = "";
        refreshOrderDeliveryLinks();
    };
    contactForm?.addEventListener("input", invalidateReceipt);
    contactForm?.addEventListener("change", invalidateReceipt);

    menuButton?.addEventListener("click", () => {
        setMenuState(!navPanel?.classList.contains("is-open"));
    });

    themeToggle?.addEventListener("click", () => {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        storedTheme = newTheme;
        setStoredValue("theme", newTheme);
        updateThemeControl();
    });

    catalogTabs.forEach((tab) => {
        tab.setAttribute("aria-pressed", String(tab.classList.contains("is-active")));
        tab.addEventListener("click", () => {
            activeCatalogTab = tab.dataset.catalogTab || "all";
            visibleCatalogLimit = catalogPageSize;
            filterCatalog();
        });
    });

    catalogSearch?.addEventListener("input", () => {
        visibleCatalogLimit = catalogPageSize;
        filterCatalog();
    });
    catalogSort?.addEventListener("change", () => {
        activeSortOrder = catalogSort.value || "featured";
        visibleCatalogLimit = catalogPageSize;
        filterCatalog();
    });
    catalogReset?.addEventListener("click", () => {
        if (catalogSearch) catalogSearch.value = "";
        if (catalogSort) catalogSort.value = activeSortOrder = "featured";
        activeCatalogTab = "all";
        visibleCatalogLimit = catalogPageSize;
        filterCatalog();
        catalogSearch?.focus();
    });
    catalogGrid?.addEventListener?.("click", (event) => {
        if (!event.target.closest("[data-catalog-more]")) return;
        visibleCatalogLimit += catalogPageSize;
        filterCatalog();
        catalogGrid.querySelector("[data-catalog-more]")?.focus({ preventScroll: true });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
        }
    });

    let scrollFrame = 0;
    const updateScrollState = () => {
        if (scrollFrame) {
            return;
        }

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            const scrollableDistance = document.documentElement.scrollHeight - window.innerHeight;
            const progress = scrollableDistance > 0 ? window.scrollY / scrollableDistance : 0;
            const scrolled = window.scrollY > 20;
            progressBar?.style.setProperty("transform", `scaleX(${Math.min(Math.max(progress, 0), 1)})`);
            header?.classList.toggle("is-scrolled", scrolled);
            toTopButton?.classList.toggle("is-visible", window.scrollY > 420);
            floatingWhatsapp?.classList.toggle("is-visible", window.scrollY > 320);
        });
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) {
            closeMenu();
        }
    });

    document.addEventListener("click", (event) => {
        if (menuButton && navPanel && !menuButton.contains(event.target) && !navPanel.contains(event.target)) {
            closeMenu();
        }
    });

    internalLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            const href = link.getAttribute("href");
            if (href && href.startsWith("#")) {
                const target = document.querySelector(href);
                if (target) {
                    event.preventDefault();
                    closeMenu();
                    target.scrollIntoView({ behavior: "smooth" });
                }
            }
        });
    });

    document.addEventListener("click", (event) => {
        const copyButton = event.target.closest("[data-copy-order]");

        if (copyButton) {
            const ui = uiText[currentLanguage];
            copyText(currentOrderMessage || buildContactOrderMessage(contactForm, currentLanguage, currentOrderCode))
                .then(() => {
                    if (formStatus) {
                        formStatus.textContent = ui.copiedOrder;
                    }
                })
                .catch(() => {
                    if (formStatus) {
                        formStatus.textContent = currentLanguage === "ar"
                            ? "تعذر النسخ تلقائيا. حدد ملخص الطلب وانسخه."
                            : "Could not copy automatically. Select the order summary and copy it.";
                    }
                });
            return;
        }

        if (event.target.closest("[data-order-send]")) {
            refreshOrderDeliveryLinks();
            return;
        }

        const directOrderButton = event.target.closest("[data-direct-order]");

        if (directOrderButton) {
            if (!contactForm) {
                window.location.assign(`/?product=${encodeURIComponent(directOrderButton.dataset.productId)}#contact`);
            } else {
                fillQuoteMessage(directOrderButton.dataset.directOrder, directOrderButton);
                document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
            }
            return;
        }

        const quoteButton = event.target.closest("[data-quote]");

        if (!quoteButton) {
            return;
        }

        fillQuoteMessage(quoteButton.dataset.quote, quoteButton);

        if (!contactForm && quoteButton.classList.contains("catalog-order")) {
            window.location.assign(`/?product=${encodeURIComponent(quoteButton.dataset.productId)}#contact`);
            return;
        }

        if (quoteButton.classList.contains("catalog-order")) {
            document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
        }
    });

    const closeProjectDialog = () => {
        if (typeof projectDialog?.close === "function") {
            projectDialog.close();
        } else {
            projectDialog?.removeAttribute("open");
        }
    };

    projectTriggers.forEach((trigger) => {
        trigger.addEventListener("click", () => {
            if (projectDialogImage) {
                projectDialogImage.src = trigger.dataset.projectImage || "";
                projectDialogImage.alt = trigger.dataset.projectTitle || "";
            }

            if (projectDialogTitle) {
                projectDialogTitle.textContent = trigger.dataset.projectTitle || uiText[currentLanguage].projectsTitle;
            }

            if (projectDialogText) {
                projectDialogText.textContent = trigger.dataset.projectText || "";
            }

            if (projectDialogQuote) {
                projectDialogQuote.dataset.quote = trigger.dataset.projectQuote || "";
            }

            if (typeof projectDialog?.showModal === "function") {
                projectDialog.showModal();
            } else {
                projectDialog?.setAttribute("open", "");
            }
        });
    });

    projectDialogQuote?.addEventListener("click", () => {
        fillQuoteMessage(projectDialogQuote.dataset.quote);
        closeProjectDialog();
    });

    projectDialogClose?.addEventListener("click", () => {
        closeProjectDialog();
    });

    projectDialog?.addEventListener("click", (event) => {
        if (event.target === projectDialog) {
            closeProjectDialog();
        }
    });

    const activateNavLink = (id) => {
        primaryNavLinks.forEach((link) => {
            const href = link.getAttribute("href") || "";
            const isActive = href === `#${id}` || href === `/#${id}` || (id === "products" && href === "/products");
            link.classList.toggle("is-active", isActive);

            if (isActive) {
                link.setAttribute("aria-current", "true");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    };

    const sections = document.querySelectorAll("main section[id]");
    const isStandaloneProductsPage = document.body.classList.contains("products-page");
    const isStandaloneProductPage = document.body.classList.contains("product-page");

    if (isStandaloneProductsPage || isStandaloneProductPage) {
        activateNavLink("products");
    } else if (sections.length && "IntersectionObserver" in window) {
        activateNavLink("home");

        const sectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        activateNavLink(entry.target.id);
                    }
                });
            },
            { rootMargin: "-35% 0px -50% 0px", threshold: 0.1 }
        );

        sections.forEach((section) => sectionObserver.observe(section));
    }

    toTopButton?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    faqItems.forEach((item) => {
        item.addEventListener("toggle", () => {
            if (!item.open) {
                return;
            }

            faqItems.forEach((otherItem) => {
                if (otherItem !== item) {
                    otherItem.open = false;
                }
            });
        });
    });

    const countUp = (counter) => {
        const target = parseInt(counter.dataset.target, 10) || 0;
        const suffix = counter.dataset.suffix || "";
        const duration = 1200;
        const startTime = performance.now();

        const update = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const value = Math.floor(progress * target);
            counter.textContent = `${value}${suffix}`;

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                counter.textContent = `${target}${suffix}`;
            }
        };

        requestAnimationFrame(update);
    };

    if ("IntersectionObserver" in window) {
        const animationObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        animationObserver.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.1 }
        );

        animatedItems.forEach((item) => {
            if (item.closest(".hero")) {
                item.classList.add("is-visible");
            } else {
                animationObserver.observe(item);
            }
        });

        window.setTimeout(() => {
            animatedItems.forEach((item) => item.classList.add("is-visible"));
        }, 1400);

        const counterObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        countUp(entry.target);
                        counterObserver.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.45 }
        );

        counters.forEach((counter) => counterObserver.observe(counter));
    } else {
        animatedItems.forEach((item) => item.classList.add("is-visible"));
        counters.forEach(countUp);
    }

    contactForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving || !contactForm.checkValidity()) {
            if (!saving) contactForm.reportValidity();
            return;
        }
        const channel = selectedOrderChannel(contactForm);
        const submissionLanguage = currentLanguage;
        const data = Object.fromEntries(new FormData(contactForm));
        delete data.deliveryChannel;
        Object.keys(data).forEach((key) => { data[key] = String(data[key]).trim(); });
        if(selectedProductId) {
            const items=selectedItems();
            if(!products.some(p=>p.id===selectedProductId) || !Number.isInteger(items[0].quantity) || items[0].quantity<1 || items[0].quantity>9999) {
                if(formStatus)formStatus.textContent=currentLanguage==='ar'?'راجع المنتج والكمية، أو ألغِ الاختيار لإرسال طلب عام.':'Check the product and quantity, or clear the selection to send a general inquiry.';
                return;
            }
            data.items=items;
        }
        if (!data.email && !data.phone) {
            if (formStatus) formStatus.textContent = uiText[currentLanguage].contactRequired;
            contactForm.querySelector('[name="phone"]')?.focus();
            return;
        }
        const snapshot = JSON.stringify(data);
        if (!pendingRequest || pendingRequest.snapshot !== snapshot) pendingRequest = { snapshot, requestId: crypto.randomUUID() };
        const button = contactForm.querySelector('[type="submit"]');
        // Reserve only the selected WhatsApp tab during the click to avoid popup blocking.
        // Email uses the visitor's preferred mail app and does not open an extra browser tab.
        let deliveryWindow = null;
        if (channel === "whatsapp") {
            try {
                deliveryWindow = window.open("about:blank", "_blank");
                if (deliveryWindow) deliveryWindow.opener = null;
            } catch { deliveryWindow?.close(); deliveryWindow = null; }
        }
        saving = true;
        if (deliveryActions) deliveryActions.hidden = true;
        contactForm.querySelectorAll('[name="deliveryChannel"]').forEach((input) => { input.disabled = true; });
        if (button) button.disabled = true;
        if (formStatus) formStatus.textContent = uiText[currentLanguage].saving;
        try {
            const response = await fetch("/api/quotes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, requestId: pendingRequest.requestId }),
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) {
                const error = new Error("Save failed");
                error.status = response.status;
                try{error.code=(await response.json()).code;}catch{}
                throw error;
            }
            const result = await response.json();
            if (!result.ok || typeof result.quoteId !== "string") throw new Error("Invalid receipt");
            if(data.items && (!Array.isArray(result.items) || !result.items.length))throw new Error('Invalid order prices');
            const currentData = Object.fromEntries(new FormData(contactForm));
            delete currentData.deliveryChannel;
            Object.keys(currentData).forEach((key) => { currentData[key] = String(currentData[key]).trim(); });
            if(selectedProductId)currentData.items=selectedItems();
            const unchanged = JSON.stringify(currentData) === snapshot;
            currentOrderCode = unchanged ? result.quoteId : "";
            confirmedItems=unchanged?(result.items || []):[];
            refreshOrderDeliveryLinks();
            let deliveryStatus = "";
            if (unchanged) {
                const message = buildContactOrderMessage(contactForm, submissionLanguage, result.quoteId)+storedPrices(result.items || [],submissionLanguage);
                const href = orderChannelHref(channel, message, submissionLanguage);
                // Opening a draft is separate from actually sending it.
                try {
                    if (channel === "email") {
                        window.location.assign(href);
                        deliveryStatus = uiText[currentLanguage].emailDraft;
                    } else if (deliveryWindow && !deliveryWindow.closed) {
                        deliveryWindow.location.replace(href);
                        deliveryStatus = uiText[currentLanguage].whatsappDraft;
                    } else {
                        deliveryStatus = uiText[currentLanguage].openSelected;
                    }
                } catch {
                    deliveryWindow?.close();
                    deliveryStatus = uiText[currentLanguage].openSelected;
                }
            } else {
                deliveryWindow?.close();
                deliveryStatus = currentLanguage === "ar" ? "التعديلات الجديدة لم تُحفظ بعد." : "Your new edits have not been saved yet.";
            }
            if (deliveryActions) deliveryActions.hidden = !unchanged;
            if (formStatus) formStatus.textContent = `${uiText[currentLanguage].saved} ${result.quoteId} ${deliveryStatus}`;
        } catch (error) {
            deliveryWindow?.close();
            if (deliveryActions) deliveryActions.hidden = false;
            refreshOrderDeliveryLinks();
            if (formStatus) formStatus.textContent = error.code==='product_unavailable'?(currentLanguage==='ar'?'المنتج اتوقف أو اتحذف قبل حفظ الطلب. اختر منتجًا آخر وأعد المحاولة.':'The product is no longer available. Choose another and retry.'):error.status === 429 ? uiText[currentLanguage].rateLimited : uiText[currentLanguage].saveFailed;
        } finally {
            saving = false;
            contactForm.querySelectorAll('[name="deliveryChannel"]').forEach((input) => { input.disabled = false; });
            if (button) button.disabled = false;
        }
    });
});
