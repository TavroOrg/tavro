import fs from "node:fs";
import path from "node:path";

const loginRoot = "/app/apps/login";

function filesUnder(dir, matcher) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(file, matcher));
    else if (matcher(file)) out.push(file);
  }
  return out;
}

function replaceInFile(file, replacements) {
  let src = fs.readFileSync(file, "utf8");
  const original = src;

  for (const [search, replacement] of replacements) {
    if (!src.includes(search)) {
      continue;
    }
    src = src.split(search).join(replacement);
  }

  if (src !== original) {
    fs.writeFileSync(file, src);
  }
}

function appendIfMissing(file, snippet) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(snippet.trim())) {
    return;
  }
  fs.writeFileSync(file, `${src}\n${snippet}\n`);
}

const jsFiles = filesUnder(loginRoot, (file) => file.endsWith(".js"));
const jsonFiles = filesUnder(loginRoot, (file) => file.endsWith(".json"));
const cssFiles = filesUnder(path.join(loginRoot, ".next", "static", "chunks"), (file) =>
  file.endsWith(".css"),
);

for (const file of [...jsFiles, ...jsonFiles]) {
  replaceInFile(file, [
    ['"register":"Register new user"', '"register":""'],
    ['"title":"Sign in to Zitadel"', '"title":"Sign in to Tavro"'],
    ['"title":"Welcome back!"', '"title":"Tavro Agent BizOps"'],
    ['"description":"Enter your login details."', '"description":"Enter your username and password."'],
    ['"/favicon.ico"', '"/ui/v2/login/favicon.png"'],
    ['"favicon.ico"', '"favicon.png"'],
  ]);
}

for (const file of jsFiles) {
  replaceInFile(file, [
    [
      'let a=(0,r.createServerReference)("4035bc55d8ad827fec95cda0a8aa14149a34bc9040",r.callServer,void 0,r.findSourceMapURL,"sendLoginname");e.s(["sendLoginname",()=>a])',
      'let a=(0,r.createServerReference)("4035bc55d8ad827fec95cda0a8aa14149a34bc9040",r.callServer,void 0,r.findSourceMapURL,"sendLoginname"),p=(0,r.createServerReference)("402da16890b6e717496232a243fe40421e6e8afa10",r.callServer,void 0,r.findSourceMapURL,"sendPassword");e.s(["sendLoginname",()=>a,"sendPassword",()=>p])',
    ],
    [
      "defaultValues:{loginName:e||\"\"}",
      "defaultValues:{loginName:e||\"\",password:\"\"}",
    ],
    [
      "let n=await (0,t.sendLoginname)({loginName:e.loginName,organization:r,defaultOrganization:g,requestId:x,suffix:f,ignoreUnknownUsernames:k?.ignoreUnknownUsernames});return(0,a.handleServerActionResponse)(n,R,E,U),n",
      "let n=e.password?await (0,t.sendPassword)({loginName:e.loginName,organization:r,defaultOrganization:g,requestId:x,checks:{password:{password:e.password}}}):await (0,t.sendLoginname)({loginName:e.loginName,organization:r,defaultOrganization:g,requestId:x,suffix:f,ignoreUnknownUsernames:k?.ignoreUnknownUsernames});return(0,a.handleServerActionResponse)(n,R,E,U),n",
    ],
    [
      'label:A,"data-testid":"username-text-input",suffix:f}),w&&(0,r.jsx)("button"',
      'label:A,"data-testid":"username-text-input",suffix:f}),(0,r.jsx)(m.TextInput,{type:"password",autoComplete:"current-password",required:!0,...j("password",{required:"Password is required"}),label:"Password","data-testid":"password-text-input"}),false&&w&&(0,r.jsx)("button"',
    ],
    [
      'e&&(0,t.jsx)(r,{lightSrc:e.lightTheme?.logoUrl,darkSrc:e.darkTheme?.logoUrl,height:150,width:150})',
      '(0,t.jsx)(r,{lightSrc:e?.lightTheme?.logoUrl||"/ui/v2/login/tavro-login-logo.svg",darkSrc:e?.darkTheme?.logoUrl||"/ui/v2/login/tavro-login-logo.svg",height:88,width:180})',
    ],
  ]);
}

const brandingSnippet = `
;(function () {
  if (typeof document === "undefined") return;
  if (!location.pathname.startsWith("/ui/v2/login")) return;

  const TITLE = "Tavro Agent BizOps";
  let headObserver = null;
  let watchdog = null;

  function enforceBranding() {
    if (document.title !== TITLE) {
      document.title = TITLE;
    }
  }

  function ensureWatchers() {
    if (document.head && !headObserver) {
      headObserver = new MutationObserver(enforceBranding);
      headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    }

    if (!watchdog) {
      let attempts = 0;
      watchdog = window.setInterval(() => {
        attempts += 1;
        enforceBranding();
        if (attempts >= 40) {
          window.clearInterval(watchdog);
          watchdog = null;
        }
      }, 250);
    }
  }

  const applyBranding = () => {
    enforceBranding();
    ensureWatchers();

    let link = document.querySelector('link[data-tavro-favicon="true"]');
    if (!link) {
      link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.setAttribute("data-tavro-favicon", "true");
    }

    link.type = "image/png";
    link.href = "/ui/v2/login/favicon.png";
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBranding, { once: true });
  } else {
    applyBranding();
  }
})();
`;

const staticJsFiles = filesUnder(path.join(loginRoot, ".next", "static"), (file) =>
  file.endsWith(".js"),
);

for (const file of staticJsFiles) {
  appendIfMissing(file, brandingSnippet);
}

for (const file of cssFiles) {
  fs.appendFileSync(
    file,
    `

/* Tavro login customizations */
[data-testid="register-button"],
[data-i18n-key="loginname.register"] {
  display: none !important;
}

[data-testid="username-text-input"] {
  margin-bottom: 10px;
}

[alt="logo"] {
  object-fit: contain;
}
`,
  );
}