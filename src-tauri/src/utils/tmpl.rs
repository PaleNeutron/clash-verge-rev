pub const ITEM_LOCAL: &str = "# Profile Template for Clash Verge

proxies: []

proxy-groups: []

rules: []
";

pub const ITEM_MERGE: &str = "# Profile Enhancement Merge Template for Clash Verge

profile:
  store-selected: true
";

pub const ITEM_MERGE_EMPTY: &str = "# Profile Enhancement Merge Template for Clash Verge

";

pub const ITEM_SCRIPT: &str = "// Define main function (script entry)

function main(config, profileName) {
  return config;
}
";

pub const ITEM_RULES: &str = "# Profile Enhancement Rules Template for Clash Verge

prepend: []

append: []

delete: []
";

pub const ITEM_PROXIES: &str = "# Profile Enhancement Proxies Template for Clash Verge

prepend: []

append: []

delete: []
";

pub const ITEM_GROUPS: &str = "# Profile Enhancement Groups Template for Clash Verge

prepend: []

append: []

delete: []
";

pub fn branded(template: &str) -> std::borrow::Cow<'_, str> {
    if crate::branding::APP_NAME == "Clash Verge" {
        template.into()
    } else {
        template.replace("Clash Verge", crate::branding::APP_NAME).into()
    }
}
