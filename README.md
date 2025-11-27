<div align="center">

# AutoBAL.AI
### Deep Learning Enhanced Spectroscopy Suite

[![React](https://img.shields.io/badge/React-19.0-blue?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Gemini AI](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-8E75B2?logo=google-gemini)](https://deepmind.google/technologies/gemini/)

</div>

---

## 🌌 Abstract

**AutoBAL.AI** is a research-grade pipeline designed for the automated analysis of **Broad Absorption Line (BAL) Quasars**. It integrates classical spectral analysis algorithms with state-of-the-art Large Language Models (LLMs) to detect, quantify, and interpret variability in quasar absorption troughs.

Targeting astrophysicists and data scientists, this tool provides a seamless workflow from raw FITS data ingestion to kinematic profiling, enabling rapid identification of outflows and accretion disk instabilities.

## 🚀 Key Features

-   **Interactive Spectral Viewer**: High-performance 16:9 visualization with multi-epoch overlays, dynamic zooming, and continuum normalization.
-   **Physics Engine**: Real-time simulation of absorption components, modeling complex trough kinematics relative to the C IV $\lambda 1549$ emission line.
-   **AI Analyst**: Integrated **Gemini 2.5 Flash** model that acts as a co-pilot, providing natural language interpretation of spectral trends, Equivalent Width (EW) evolution, and velocity shifts.
-   **Algorithmic Detection**: Automated identification of absorption troughs using smoothed derivatives, calculating key metrics like EW, Centroid Velocity, and Optical Depth.

## 🔬 Scientific Methodology

AutoBAL.AI implements a rigorous reduction pipeline to ensure scientific accuracy:

### 1. Redshift Correction & Rest Frame
Spectra are transformed to the quasar rest frame using the cosmological redshift $z$:
$$ \lambda_{rest} = \frac{\lambda_{obs}}{1 + z} $$
*Default simulation redshift: $z \approx 2.0$*

### 2. Continuum Fitting & Normalization
To isolate absorption features, the continuum is modeled as a power law:
$$ F_{cont}(\lambda) = A \cdot \left(\frac{\lambda}{1450}\right)^\alpha $$
The spectrum is then normalized:
$$ F_{norm}(\lambda) = \frac{F_{\lambda}}{F_{cont}(\lambda)} $$

### 3. Signal Smoothing (Savitzky-Golay)
To mitigate high-frequency noise while preserving line profiles, a **Savitzky-Golay filter** is applied:
-   **Window Length**: 5 pixels
-   **Polynomial Order**: 3
This technique is superior to boxcar averaging for preserving trough depth and structure.

### 4. Kinematic Analysis
For each detected trough, the following metrics are derived:
-   **Equivalent Width (EW)**: $\int (1 - F_{norm}(\lambda)) d\lambda$
-   **Max Depth**: $1 - \min(F_{norm})$
-   **Centroid Velocity**: Calculated relative to C IV ($1549 \mathring{A}$):
    $$ v = c \cdot \frac{1549 - \lambda_{obs}}{1549} $$

## 🛠 Technical Architecture

The application is built on a modern, type-safe stack designed for performance and scalability:

-   **Frontend**: React 19, Vite, TypeScript
-   **Styling**: Tailwind CSS (Dark Mode / Sci-Fi Dashboard Theme)
-   **Visualization**: Recharts (D3-based) for responsive spectral plotting
-   **AI Layer**: Google GenAI SDK (Gemini 2.5 Flash)
-   **Data Parsing**: Custom FITS/Header parsers for SDSS-style nomenclature

## 💻 Installation & Usage

### Prerequisites
-   Node.js v18+
-   npm or yarn

### Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/autobal-ai.git
    cd autobal-ai
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env.local` file in the root directory and add your Gemini API key:
    ```env
    VITE_GEMINI_API_KEY=your_api_key_here
    ```

4.  **Run Locally**
    ```bash
    npm run dev
    ```

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request for any bugs, feature requests, or scientific improvements.

## 📄 License

This project is opensource and made for educational purpose.
