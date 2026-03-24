use wasm_bindgen::prelude::*;
use regex::Regex;

#[wasm_bindgen]
pub struct SearchResult {
    line: u32,
    start: u32,
    end: u32,
    text: String,
}

#[wasm_bindgen]
impl SearchResult {
    #[wasm_bindgen(getter)]
    pub fn line(&self) -> u32 {
        self.line
    }

    #[wasm_bindgen(getter)]
    pub fn start(&self) -> u32 {
        self.start
    }

    #[wasm_bindgen(getter)]
    pub fn end(&self) -> u32 {
        self.end
    }

    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.text.clone()
    }
}

#[wasm_bindgen]
pub fn search_buffer(buffer: &str, pattern: &str, case_sensitive: bool) -> Vec<SearchResult> {
    let regex_pattern = if case_sensitive {
        pattern.to_string()
    } else {
        format!("(?i){}", pattern)
    };

    let re = match Regex::new(&regex_pattern) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();

    for (line_idx, line) in buffer.lines().enumerate() {
        for mat in re.find_iter(line) {
            results.push(SearchResult {
                line: line_idx as u32,
                start: mat.start() as u32,
                end: mat.end() as u32,
                text: mat.as_str().to_string(),
            });
        }
    }

    results
}
