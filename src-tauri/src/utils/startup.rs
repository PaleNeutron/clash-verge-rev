use crate::utils::dirs;
use anyhow::{Context as _, Result};
use chrono::Local;
use std::{
    fs::OpenOptions,
    io::Write as _,
    path::{Path, PathBuf},
};

const STARTUP_LOG_FILE: &str = "startup.log";

pub(crate) fn report_error(error: &anyhow::Error) {
    let detail = format!("{error:#}");
    eprintln!("[{}] startup failed: {detail}", crate::branding::APP_BINARY);

    let log_result = startup_log_path().and_then(|path| {
        append_error(&path, &detail).with_context(|| format!("startup log {}", path.display()))?;
        Ok(path)
    });
    let message = match log_result {
        Ok(path) => format!(
            "{} could not start.\n\n{detail}\n\nDiagnostic log:\n{}",
            crate::branding::APP_NAME,
            path.display()
        ),
        Err(log_error) => {
            eprintln!(
                "[{}] failed to write startup log: {log_error:#}",
                crate::branding::APP_BINARY
            );
            format!(
                "{} could not start.\n\n{detail}\n\nThe diagnostic log could not be written:\n{log_error:#}",
                crate::branding::APP_NAME
            )
        }
    };

    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(format!("{} startup failed", crate::branding::APP_NAME))
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

fn startup_log_path() -> Result<PathBuf> {
    Ok(dirs::preinit_app_data_dir()?.join("logs").join(STARTUP_LOG_FILE))
}

fn append_error(path: &Path, detail: &str) -> Result<()> {
    let parent = path.parent().context("startup log has no parent directory")?;
    std::fs::create_dir_all(parent).context("failed to create startup log directory")?;

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options.open(path).context("failed to open startup log")?;
    writeln!(
        file,
        "[{}] ERROR [Startup] {detail}",
        Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
    )
    .context("failed to write startup log")?;
    file.flush().context("failed to flush startup log")?;
    Ok(())
}
