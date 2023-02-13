/**
 * @fileoverview
 * Complete Scanner build on top of {@link Html5Qrcode}.
 * - Decode QR Code using web cam or smartphone camera
 * 
 * @author mebjas <minhazav@gmail.com>
 * 
 * The word "QR Code" is registered trademark of DENSO WAVE INCORPORATED
 * http://www.denso-wave.com/qrcode/faqpatent-e.html
 */
import {
    Html5QrcodeConstants,
    Html5QrcodeScanType,
    QrcodeSuccessCallback,
    QrcodeErrorCallback,
    Html5QrcodeResult,
    Html5QrcodeError,
    Html5QrcodeErrorFactory,
    BaseLoggger,
    Logger,
    isNullOrUndefined,
    clip,
} from "./core";

import { CameraCapabilities } from "./camera/core";

import { CameraDevice } from "./camera/core";

import {
    Html5Qrcode,
    Html5QrcodeConfigs,
    Html5QrcodeCameraScanConfig,
    Html5QrcodeFullConfig,
} from "./html5-qrcode";

import {
    Html5QrcodeScannerStrings,
} from "./strings";

import {
    ASSET_FILE_SCAN,
    ASSET_CAMERA_SCAN,
} from "./image-assets";

import {
    PersistedDataManager
} from "./storage";

import {
    LibraryInfoContainer
} from "./ui";

import {
    CameraPermissions
} from "./camera/permissions";

import { Html5QrcodeScannerState } from "./state-manager";

import { ScanTypeSelector } from "./ui/scanner/scan-type-selector";

import { TorchButton } from "./ui/scanner/torch-button";

import {
    FileSelectionUi,
    OnFileSelected
} from "./ui/scanner/file-selection-ui";

import {
    BaseUiElementFactory,
    PublicUiElementIdAndClasses
} from "./ui/scanner/base";

import { CameraSelectionUi } from "./ui/scanner/camera-selection-ui";
import { CameraZoomUi } from "./ui/scanner/camera-zoom-ui";

/**
 * Different states of QR Code Scanner.
 */
enum Html5QrcodeScannerStatus {
    STATUS_DEFAULT = 0,
    STATUS_SUCCESS = 1,
    STATUS_WARNING = 2,
    STATUS_REQUESTING_PERMISSION = 3,
}

/**
 * Interface for controlling different aspects of {@class Html5QrcodeScanner}.
 */
interface Html5QrcodeScannerConfig
    extends Html5QrcodeCameraScanConfig, Html5QrcodeConfigs {

    /**
     * If {@code true} the library will remember if the camera permissions
     * were previously granted and what camera was last used. If the permissions
     * is already granted for "camera", QR code scanning will automatically
     * start for previously used camera.
     * 
     * Note: default value is {@code true}.
     */
    rememberLastUsedCamera?: boolean | undefined;

    /**
     * Sets the desired scan types to be supported in the scanner.
     * 
     *  - Not setting a value will follow the default order supported by
     *      library.
     *  - First value would be used as the default value. Example:
     *    - [SCAN_TYPE_CAMERA, SCAN_TYPE_FILE]: Camera will be default type,
     *      user can switch to file based scan.
     *    - [SCAN_TYPE_FILE, SCAN_TYPE_CAMERA]: File based scan will be default
     *      type, user can switch to camera based scan.
     *  - Setting only value will disable option to switch to other. Example:
     *    - [SCAN_TYPE_CAMERA] - Only camera based scan supported.
     *    - [SCAN_TYPE_FILE] - Only file based scan supported.
     *  - Setting wrong values or multiple values will fail.
     */
    supportedScanTypes?: Array<Html5QrcodeScanType> | [];

    /**
     * If {@code true} the rendered UI will have button to turn flash on or off
     * based on device + browser support.
     * 
     * Note: default value is {@code false}.
     */
    showTorchButtonIfSupported?: boolean | undefined;

    /**
     * If {@code true} the rendered UI will have slider to zoom camera based on
     * device + browser support.
     * 
     * Note: default value is {@code false}.
     * 
     * TODO(minhazav): Document this API, currently hidden.
     */
    showZoomSliderIfSupported?: boolean | undefined;

    /**
     * Default zoom value if supported.
     * 
     * Note: default value is 1x.
     * 
     * TODO(minhazav): Document this API, currently hidden.
     */
    defaultZoomValueIfSupported?: number | undefined;
}

function toHtml5QrcodeCameraScanConfig(config: Html5QrcodeScannerConfig)
    : Html5QrcodeCameraScanConfig {
    return {
        fps: config.fps,
        qrbox: config.qrbox,
        aspectRatio: config.aspectRatio,
        disableFlip: config.disableFlip,
        videoConstraints: config.videoConstraints
    };
}

function toHtml5QrcodeFullConfig(
    config: Html5QrcodeConfigs, verbose: boolean | undefined)
    : Html5QrcodeFullConfig {
    return {
        formatsToSupport: config.formatsToSupport,
        useBarCodeDetectorIfSupported: config.useBarCodeDetectorIfSupported,
        experimentalFeatures: config.experimentalFeatures,
        verbose: verbose
    };
}

// End to end scanner library.
export class Html5QrcodeScanner {

    //#region private fields
    private container: HTMLElement;
    private config: Html5QrcodeScannerConfig;
    private verbose: boolean;
    private currentScanType: Html5QrcodeScanType;
    private sectionSwapAllowed: boolean;
    private persistedDataManager: PersistedDataManager;
    private scanTypeSelector: ScanTypeSelector;
    private logger: Logger;

    // Initially null fields.
    private html5Qrcode: Html5Qrcode | undefined;
    private qrCodeSuccessCallback: QrcodeSuccessCallback | undefined;
    private qrCodeErrorCallback: QrcodeErrorCallback | undefined;
    private lastMatchFound: string | null = null;
    private cameraScanImage: HTMLImageElement | null = null;
    private fileScanImage: HTMLImageElement | null = null;
    private fileSelectionUi: FileSelectionUi | null = null;
    // DOM Elements
    private scpCameraScanRegion: HTMLDivElement | null = null;
    private dashboardSection: HTMLDivElement | null = null;
    private permissionButton: HTMLButtonElement | null = null;
    private headerMessageContainer: HTMLDivElement | null = null;
    private qrCodeScanRegion: HTMLDivElement | null = null;
    private switchScanTypeLink: HTMLAnchorElement | null = null;
    //#endregion

    /**
     * Creates instance of this class.
     *
     * @param elementId Id of the HTML element.
     * @param config Extra configurations to tune the code scanner.
     * @param verbose - If true, all logs would be printed to console. 
     */
    public constructor(
        elementId: string,
        config: Html5QrcodeScannerConfig | undefined,
        verbose: boolean | undefined);

    /**
     * Creates instance of this class.
     *
     * @param element The HTML DOM element.
     * @param config Extra configurations to tune the code scanner.
     * @param verbose - If true, all logs would be printed to console. 
     */
    public constructor(
        element: HTMLElement,
        config: Html5QrcodeScannerConfig | undefined,
        verbose: boolean | undefined);

    /**
     * Creates instance of this class.
     *
     * @param elementOrId The HTML DOM element or its Id.
     * @param config Extra configurations to tune the code scanner.
     * @param verbose - If true, all logs would be printed to console. 
     */
    public constructor(
        elementOrId: HTMLElement | string,
        config: Html5QrcodeScannerConfig | undefined,
        verbose: boolean | undefined) {
        if (typeof elementOrId === "string") {
            this.container = this.validateInputAsStringId(elementOrId);
        } else {
            this.container = this.validateInputAsHTMLElement(elementOrId);
        }
        this.config = this.createConfig(config);
        this.verbose = verbose === true;

        this.scanTypeSelector = new ScanTypeSelector(
            this.config.supportedScanTypes);
        this.currentScanType = this.scanTypeSelector.getDefaultScanType();

        this.sectionSwapAllowed = true;
        this.logger = new BaseLoggger(this.verbose);

        this.persistedDataManager = new PersistedDataManager();
        if (config!.rememberLastUsedCamera !== true) {
            this.persistedDataManager.reset();
        }
    }

    /**
     * Renders the User Interface.
     * 
     * @param qrCodeSuccessCallback Callback called when an instance of a QR
     * code or any other supported bar code is found.
     * @param qrCodeErrorCallback optional, callback called in cases where no
     * instance of QR code or any other supported bar code is found.
     */
    public render(
        qrCodeSuccessCallback: QrcodeSuccessCallback,
        qrCodeErrorCallback: QrcodeErrorCallback | undefined) {
        this.lastMatchFound = null;

        // Add wrapper to success callback.
        this.qrCodeSuccessCallback
            = (decodedText: string, result: Html5QrcodeResult) => {
                if (qrCodeSuccessCallback) {
                    qrCodeSuccessCallback(decodedText, result);
                } else {
                    if (this.lastMatchFound === decodedText) {
                        return;
                    }

                    this.lastMatchFound = decodedText;
                    this.setHeaderMessage(
                        Html5QrcodeScannerStrings.lastMatch(decodedText),
                        Html5QrcodeScannerStatus.STATUS_SUCCESS);
                }
            };

        // Add wrapper to failure callback
        this.qrCodeErrorCallback =
            (errorMessage: string, error: Html5QrcodeError) => {
                if (qrCodeErrorCallback) {
                    qrCodeErrorCallback(errorMessage, error);
                }
            };

        if (!this.container) {
            throw 'HTML Element not found';
        }
        this.container.innerHTML = "";
        this.createBasicLayout(this.container!);
        this.html5Qrcode = new Html5Qrcode(
            this.qrCodeScanRegion!,
            toHtml5QrcodeFullConfig(this.config, this.verbose));
    }

    //#region State related public APIs
    /**
     * Pauses the ongoing scan.
     * 
     * Notes:
     * -   Should only be called if camera scan is ongoing.
     * 
     * @param shouldPauseVideo (Optional, default = false) If {@code true}
     * the video will be paused.
     * 
     * @throws error if method is called when scanner is not in scanning state.
     */
    public pause(shouldPauseVideo?: boolean) {
        if (isNullOrUndefined(shouldPauseVideo) || shouldPauseVideo !== true) {
            shouldPauseVideo = false;
        }

        this.getHtml5QrcodeOrFail().pause(shouldPauseVideo);
    }

    /**
     * Resumes the paused scan.
     * 
     * If the video was previously paused by setting {@code shouldPauseVideo}
     * to {@code true} in {@link Html5QrcodeScanner#pause(shouldPauseVideo)},
     * calling this method will resume the video.
     * 
     * Notes:
     * -   Should only be called if camera scan is ongoing.
     * -   With this caller will start getting results in success and error
     * callbacks.
     * 
     * @throws error if method is called when scanner is not in paused state.
     */
    public resume() {
        this.getHtml5QrcodeOrFail().resume();
    }

    /**
     * Gets state of the camera scan.
     *
     * @returns state of type {@enum Html5QrcodeScannerState}.
     */
    public getState(): Html5QrcodeScannerState {
        return this.getHtml5QrcodeOrFail().getState();
    }

    /**
     * Removes the QR Code scanner UI.
     * 
     * @returns Promise which succeeds if the cleanup is complete successfully,
     *  fails otherwise.
     */
    public clear(): Promise<void> {
        const emptyHtmlContainer = () => {
            if (this.container) {
                this.container.innerHTML = "";
                this.resetBasicLayout(this.container);
            }
        }

        if (this.html5Qrcode) {
            return new Promise((resolve, reject) => {
                if (!this.html5Qrcode) {
                    resolve();
                    return;
                }
                if (this.html5Qrcode.isScanning) {
                    this.html5Qrcode.stop().then((_) => {
                        if (!this.html5Qrcode) {
                            resolve();
                            return;
                        }

                        this.html5Qrcode.clear();
                        emptyHtmlContainer();
                        resolve();
                    }).catch((error) => {
                        if (this.verbose) {
                            this.logger.logError(
                                "Unable to stop qrcode scanner", error);
                        }
                        reject(error);
                    });
                } else {
                    // Assuming file based scan was ongoing.
                    this.html5Qrcode.clear();
                    emptyHtmlContainer();
                    resolve();
                }
            });
        }

        return Promise.resolve();
    }
    //#endregion

    //#region Beta APIs to modify running stream state.
    /**
     * Returns the capabilities of the running video track.
     * 
     * Read more: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getConstraints
     * 
     * Note: Should only be called if {@code Html5QrcodeScanner#getState()}
     *   returns {@code Html5QrcodeScannerState#SCANNING} or 
     *   {@code Html5QrcodeScannerState#PAUSED}.
     *
     * @returns the capabilities of a running video track.
     * @throws error if the scanning is not in running state.
     */
    public getRunningTrackCapabilities(): MediaTrackCapabilities {
        return this.getHtml5QrcodeOrFail().getRunningTrackCapabilities();
    }

    /**
     * Returns the object containing the current values of each constrainable
     * property of the running video track.
     * 
     * Read more: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings
     * 
     * Note: Should only be called if {@code Html5QrcodeScanner#getState()}
     *   returns {@code Html5QrcodeScannerState#SCANNING} or 
     *   {@code Html5QrcodeScannerState#PAUSED}.
     *
     * @returns the supported settings of the running video track.
     * @throws error if the scanning is not in running state.
     */
    public getRunningTrackSettings(): MediaTrackSettings {
        return this.getHtml5QrcodeOrFail().getRunningTrackSettings();
    }

    /**
     * Apply a video constraints on running video track from camera.
     *
     * Note: Should only be called if {@code Html5QrcodeScanner#getState()}
     *   returns {@code Html5QrcodeScannerState#SCANNING} or 
     *   {@code Html5QrcodeScannerState#PAUSED}.
     *
     * @param {MediaTrackConstraints} specifies a variety of video or camera
     *  controls as defined in
     *  https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
     * @returns a Promise which succeeds if the passed constraints are applied,
     *  fails otherwise.
     * @throws error if the scanning is not in running state.
     */
    public applyVideoConstraints(videoConstraints: MediaTrackConstraints)
        : Promise<void> {
        return this.getHtml5QrcodeOrFail().applyVideoConstraints(videoConstraints);
    }
    //#endregion

    //#region Private methods

    /**
     * Verifies if the element id is valid and returns the corresponding HTML Element.
     * @param elementId Id of the HTML element.
     * @returns a valid HTML Element.
     */
    private validateInputAsStringId(elementId: string): HTMLElement {
        const element = document.getElementById(elementId) as HTMLElement;
        if (!element) {
            throw `HTML Element with id=${elementId} not found`;
        }
        return element;
    }

    /**
     * Verifies if the parameter is a valid HTML Element and returns it.
     * @param element The HTML DOM Element.
     * @returns a valid HTML Element.
     */
    private validateInputAsHTMLElement(element: HTMLElement): HTMLElement {
        if (!element || !(element instanceof HTMLElement)) {
            throw 'HTML Element is not valid';
        }
        return element;
    }

    private getHtml5QrcodeOrFail() {
        if (!this.html5Qrcode) {
            throw "Code scanner not initialized.";
        }
        return this.html5Qrcode!;
    }

    private createConfig(config: Html5QrcodeScannerConfig | undefined)
        : Html5QrcodeScannerConfig {
        if (config) {
            if (!config.fps) {
                config.fps = Html5QrcodeConstants.SCAN_DEFAULT_FPS;
            }

            if (config.rememberLastUsedCamera !== (
                !Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED)) {
                config.rememberLastUsedCamera
                    = Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED;
            }

            if (!config.supportedScanTypes) {
                config.supportedScanTypes
                    = Html5QrcodeConstants.DEFAULT_SUPPORTED_SCAN_TYPE;
            }

            return config;
        }

        return {
            fps: Html5QrcodeConstants.SCAN_DEFAULT_FPS,
            rememberLastUsedCamera:
                Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED,
            supportedScanTypes:
                Html5QrcodeConstants.DEFAULT_SUPPORTED_SCAN_TYPE
        };
    }

    private createBasicLayout(parent: HTMLElement) {
        parent.style.position = "relative";
        parent.style.padding = "0px";
        parent.style.border = "1px solid silver";
        this.createHeader(parent);

        this.qrCodeScanRegion = document.createElement("div");
        const scanRegionId = this.getScanRegionId();
        this.qrCodeScanRegion.id = scanRegionId;
        this.qrCodeScanRegion.style.width = "100%";
        this.qrCodeScanRegion.style.minHeight = "100px";
        this.qrCodeScanRegion.style.textAlign = "center";
        parent.appendChild(this.qrCodeScanRegion);
        if (ScanTypeSelector.isCameraScanType(this.currentScanType)) {
            this.insertCameraScanImageToScanRegion();
        } else {
            this.insertFileScanImageToScanRegion();
        }

        const qrCodeDashboard = document.createElement("div");
        const dashboardId = this.getDashboardId();
        qrCodeDashboard.id = dashboardId;
        qrCodeDashboard.style.width = "100%";
        parent.appendChild(qrCodeDashboard);

        this.setupInitialDashboard(qrCodeDashboard);
    }

    private resetBasicLayout(mainContainer: HTMLElement) {
        mainContainer.style.border = "none";
    }

    private setupInitialDashboard(dashboard: HTMLElement) {
        this.createSection(dashboard);
        this.createSectionControlPanel();
        if (this.scanTypeSelector.hasMoreThanOneScanType()) {
            this.createSectionSwap();
        }
    }

    private createHeader(dashboard: HTMLElement) {
        const header = document.createElement("div");
        header.style.textAlign = "left";
        header.style.margin = "0px";
        dashboard.appendChild(header);

        let libraryInfo = new LibraryInfoContainer();
        libraryInfo.renderInto(header);

        this.headerMessageContainer = document.createElement("div");
        this.headerMessageContainer.id = this.getHeaderMessageContainerId();
        this.headerMessageContainer.style.display = "none";
        this.headerMessageContainer.style.textAlign = "center";
        this.headerMessageContainer.style.fontSize = "14px";
        this.headerMessageContainer.style.padding = "2px 10px";
        this.headerMessageContainer.style.margin = "4px";
        this.headerMessageContainer.style.borderTop = "1px solid #f6f6f6";
        header.appendChild(this.headerMessageContainer);
    }

    private createSection(dashboard: HTMLElement) {
        this.dashboardSection = document.createElement("div");
        this.dashboardSection.id = this.getDashboardSectionId();
        this.dashboardSection.style.width = "100%";
        this.dashboardSection.style.padding = "10px 0px 10px 0px";
        this.dashboardSection.style.textAlign = "left";
        dashboard.appendChild(this.dashboardSection);
    }

    private createCameraListUi(
        scpCameraScanRegion: HTMLDivElement,
        requestPermissionContainer: HTMLDivElement,
        requestPermissionButton?: HTMLButtonElement) {
        const $this = this;
        $this.showHideScanTypeSwapLink(false);
        $this.setHeaderMessage(
            Html5QrcodeScannerStrings.cameraPermissionRequesting());

        const createPermissionButtonIfNotExists = () => {
            if (!requestPermissionButton) {
                $this.createPermissionButton(
                    scpCameraScanRegion, requestPermissionContainer);
            }
        }

        Html5Qrcode.getCameras().then((cameras) => {
            // By this point the user has granted camera permissions.
            $this.persistedDataManager.setHasPermission(
                /* hasPermission */ true);
            $this.showHideScanTypeSwapLink(true);
            $this.resetHeaderMessage();
            if (cameras && cameras.length > 0) {
                scpCameraScanRegion.removeChild(requestPermissionContainer);
                $this.renderCameraSelection(cameras);
            } else {
                $this.setHeaderMessage(
                    Html5QrcodeScannerStrings.noCameraFound(),
                    Html5QrcodeScannerStatus.STATUS_WARNING);
                createPermissionButtonIfNotExists();
            }
        }).catch((error) => {
            $this.persistedDataManager.setHasPermission(
                /* hasPermission */ false);

            if (requestPermissionButton) {
                requestPermissionButton.disabled = false;
            } else {
                // Case when the permission button generation was skipped
                // likely due to persistedDataManager indicated permissions
                // exists.
                // This should ideally never happen, but if it so happened that
                // the camera retrieval failed, we want to create button this
                // time.
                createPermissionButtonIfNotExists();
            }
            $this.setHeaderMessage(
                error, Html5QrcodeScannerStatus.STATUS_WARNING);
            $this.showHideScanTypeSwapLink(true);
        });
    }

    private createPermissionButton(
        scpCameraScanRegion: HTMLDivElement,
        requestPermissionContainer: HTMLDivElement) {
        const $this = this;
        const requestPermissionButton = BaseUiElementFactory
            .createElement<HTMLButtonElement>(
                "button", this.getCameraPermissionButtonId());
        requestPermissionButton.innerText
            = Html5QrcodeScannerStrings.cameraPermissionTitle();

        requestPermissionButton.addEventListener("click", function () {
            requestPermissionButton.disabled = true;
            $this.createCameraListUi(
                scpCameraScanRegion,
                requestPermissionContainer,
                requestPermissionButton);
        });
        requestPermissionContainer.appendChild(requestPermissionButton);
    }

    private createPermissionsUi(
        scpCameraScanRegion: HTMLDivElement,
        requestPermissionContainer: HTMLDivElement) {
        const $this = this;

        // Only render last selected camera by default if the default scant type
        // is camera.
        if (ScanTypeSelector.isCameraScanType(this.currentScanType)
            && this.persistedDataManager.hasCameraPermissions()) {
            CameraPermissions.hasPermissions().then(
                (hasPermissions: boolean) => {
                    if (hasPermissions) {
                        $this.createCameraListUi(
                            scpCameraScanRegion, requestPermissionContainer);
                    } else {
                        $this.persistedDataManager.setHasPermission(
                        /* hasPermission */ false);
                        $this.createPermissionButton(
                            scpCameraScanRegion, requestPermissionContainer);
                    }
                }).catch((_: any) => {
                    $this.persistedDataManager.setHasPermission(
                    /* hasPermission */ false);
                    $this.createPermissionButton(
                        scpCameraScanRegion, requestPermissionContainer);
                });
            return;
        }

        this.createPermissionButton(
            scpCameraScanRegion, requestPermissionContainer);
    }

    private createSectionControlPanel() {
        const sectionControlPanel = document.createElement("div");
        this.dashboardSection!.appendChild(sectionControlPanel);
        this.scpCameraScanRegion = document.createElement("div");
        this.scpCameraScanRegion.id = this.getDashboardSectionCameraScanRegionId();
        this.scpCameraScanRegion.style.display
            = ScanTypeSelector.isCameraScanType(this.currentScanType)
                ? "block" : "none";
        sectionControlPanel.appendChild(this.scpCameraScanRegion);

        // Web browsers require the users to grant explicit permissions before
        // giving camera access. We need to render a button to request user
        // permission.
        // Assuming when the object is created permission is needed.
        const requestPermissionContainer = document.createElement("div");
        requestPermissionContainer.style.textAlign = "center";
        this.scpCameraScanRegion.appendChild(requestPermissionContainer);

        // TODO(minhazav): If default scan type is file, the permission or
        // camera access shouldn't start unless user explicitly switches to
        // camera based scan. @priority: high.

        if (this.scanTypeSelector.isCameraScanRequired()) {
            this.createPermissionsUi(
                this.scpCameraScanRegion, requestPermissionContainer);
        }

        this.renderFileScanUi(sectionControlPanel);
    }

    private renderFileScanUi(parent: HTMLDivElement) {
        let showOnRender = ScanTypeSelector.isFileScanType(
            this.currentScanType);
        const $this = this;
        let onFileSelected: OnFileSelected = (file: File) => {
            if (!$this.html5Qrcode) {
                throw "html5Qrcode not defined";
            }

            if (!ScanTypeSelector.isFileScanType($this.currentScanType)) {
                return;
            }

            $this.setHeaderMessage(Html5QrcodeScannerStrings.loadingImage());
            $this.html5Qrcode.scanFileV2(file, /* showImage= */ true)
                .then((html5qrcodeResult: Html5QrcodeResult) => {
                    $this.resetHeaderMessage();
                    $this.qrCodeSuccessCallback!(
                        html5qrcodeResult.decodedText,
                        html5qrcodeResult);
                })
                .catch((error) => {
                    $this.setHeaderMessage(
                        error, Html5QrcodeScannerStatus.STATUS_WARNING);
                    $this.qrCodeErrorCallback!(
                        error, Html5QrcodeErrorFactory.createFrom(error));
                });
        };

        this.fileSelectionUi = FileSelectionUi.create(
            parent, showOnRender, onFileSelected);
    }

    private renderCameraSelection(cameras: Array<CameraDevice>) {
        const $this = this;
        this.scpCameraScanRegion!.style.textAlign = "center";

        // Hide by default.
        let cameraZoomUi: CameraZoomUi = CameraZoomUi.create(
            this.scpCameraScanRegion as HTMLElement, /* renderOnCreate= */ false);
        const renderCameraZoomUiIfSupported
            = (cameraCapabilities: CameraCapabilities) => {
                let zoomCapability = cameraCapabilities.zoomFeature();
                if (!zoomCapability.isSupported()) {
                    return;
                }

                // Supported.
                cameraZoomUi.setOnCameraZoomValueChangeCallback((zoomValue) => {
                    zoomCapability.apply(zoomValue);
                });
                let defaultZoom = 1;
                if (this.config.defaultZoomValueIfSupported) {
                    defaultZoom = this.config.defaultZoomValueIfSupported;
                }
                defaultZoom = clip(
                    defaultZoom, zoomCapability.min(), zoomCapability.max());
                cameraZoomUi.setValues(
                    zoomCapability.min(),
                    zoomCapability.max(),
                    defaultZoom,
                    zoomCapability.step(),
                );
                cameraZoomUi.show();
            };

        let cameraSelectUi: CameraSelectionUi = CameraSelectionUi.create(
            this.scpCameraScanRegion as HTMLElement, cameras);

        // Camera Action Buttons.
        const cameraActionContainer = document.createElement("span");
        const cameraActionStartButton
            = BaseUiElementFactory.createElement<HTMLButtonElement>(
                "button", PublicUiElementIdAndClasses.CAMERA_START_BUTTON_ID);
        cameraActionStartButton.innerText
            = Html5QrcodeScannerStrings.scanButtonStartScanningText();
        cameraActionContainer.appendChild(cameraActionStartButton);

        const cameraActionStopButton
            = BaseUiElementFactory.createElement<HTMLButtonElement>(
                "button", PublicUiElementIdAndClasses.CAMERA_STOP_BUTTON_ID);
        cameraActionStopButton.innerText
            = Html5QrcodeScannerStrings.scanButtonStopScanningText();
        cameraActionStopButton.style.display = "none";
        cameraActionStopButton.disabled = true;
        cameraActionContainer.appendChild(cameraActionStopButton);

        // Optional torch button support.
        let torchButton: TorchButton;
        const createAndShowTorchButtonIfSupported
            = (cameraCapabilities: CameraCapabilities) => {
                if (!cameraCapabilities.torchFeature().isSupported()) {
                    // Torch not supported, ignore.
                    if (torchButton) {
                        torchButton.hide();
                    }
                    return;
                }

                if (!torchButton) {
                    torchButton = TorchButton.create(
                        cameraActionContainer,
                        cameraCapabilities.torchFeature(),
                        { display: "none", marginLeft: "5px" },
                        // Callback in case of torch action failure.
                        (errorMessage) => {
                            $this.setHeaderMessage(
                                errorMessage,
                                Html5QrcodeScannerStatus.STATUS_WARNING);
                        }
                    );
                } else {
                    torchButton.updateTorchCapability(
                        cameraCapabilities.torchFeature());
                }
                torchButton.show();
            };

        this.scpCameraScanRegion!.appendChild(cameraActionContainer);

        const resetCameraActionStartButton = (shouldShow: boolean) => {
            if (!shouldShow) {
                cameraActionStartButton.style.display = "none";
            }
            cameraActionStartButton.innerText
                = Html5QrcodeScannerStrings
                    .scanButtonStartScanningText();
            cameraActionStartButton.style.opacity = "1";
            cameraActionStartButton.disabled = false;
            if (shouldShow) {
                cameraActionStartButton.style.display = "inline-block";
            }
        };

        cameraActionStartButton.addEventListener("click", (_) => {
            // Update the UI.
            cameraActionStartButton.innerText
                = Html5QrcodeScannerStrings.scanButtonScanningStarting();
            cameraSelectUi.disable();
            cameraActionStartButton.disabled = true;
            cameraActionStartButton.style.opacity = "0.5";
            // Swap link is available only when both scan types are required.
            if (this.scanTypeSelector.hasMoreThanOneScanType()) {
                $this.showHideScanTypeSwapLink(false);
            }
            $this.resetHeaderMessage();

            // Attempt starting the camera.
            const cameraId = cameraSelectUi.getValue();
            $this.persistedDataManager.setLastUsedCameraId(cameraId);

            $this.html5Qrcode!.start(
                cameraId,
                toHtml5QrcodeCameraScanConfig($this.config),
                $this.qrCodeSuccessCallback!,
                $this.qrCodeErrorCallback!)
                .then((_) => {
                    cameraActionStopButton.disabled = false;
                    cameraActionStopButton.style.display = "inline-block";
                    resetCameraActionStartButton(/* shouldShow= */ false);

                    const cameraCapabilities
                        = $this.html5Qrcode!.getRunningTrackCameraCapabilities();

                    // Show torch button if needed.
                    if (this.config.showTorchButtonIfSupported === true) {
                        createAndShowTorchButtonIfSupported(cameraCapabilities);
                    }
                    // Show zoom slider if needed.
                    if (this.config.showZoomSliderIfSupported === true) {
                        renderCameraZoomUiIfSupported(cameraCapabilities);
                    }
                })
                .catch((error) => {
                    $this.showHideScanTypeSwapLink(true);
                    cameraSelectUi.enable();
                    resetCameraActionStartButton(/* shouldShow= */ true);
                    $this.setHeaderMessage(
                        error, Html5QrcodeScannerStatus.STATUS_WARNING);
                });
        });

        if (cameraSelectUi.hasSingleItem()) {
            // If there is only one camera, start scanning directly.
            cameraActionStartButton.click();
        }

        cameraActionStopButton.addEventListener("click", (_) => {
            if (!$this.html5Qrcode) {
                throw "html5Qrcode not defined";
            }
            cameraActionStopButton.disabled = true;
            $this.html5Qrcode.stop()
                .then((_) => {
                    // Swap link is required if more than one scan types are
                    // required.
                    if (this.scanTypeSelector.hasMoreThanOneScanType()) {
                        $this.showHideScanTypeSwapLink(true);
                    }

                    cameraSelectUi.enable();
                    cameraActionStartButton.disabled = false;
                    cameraActionStopButton.style.display = "none";
                    cameraActionStartButton.style.display = "inline-block";
                    // Reset torch state.
                    if (torchButton) {
                        torchButton.reset();
                        torchButton.hide();
                    }
                    cameraZoomUi.removeOnCameraZoomValueChangeCallback();
                    cameraZoomUi.hide();
                    $this.insertCameraScanImageToScanRegion();
                }).catch((error) => {
                    cameraActionStopButton.disabled = false;
                    $this.setHeaderMessage(
                        error, Html5QrcodeScannerStatus.STATUS_WARNING);
                });
        });

        if ($this.persistedDataManager.getLastUsedCameraId()) {
            const cameraId = $this.persistedDataManager.getLastUsedCameraId()!;
            if (cameraSelectUi.hasValue(cameraId)) {
                cameraSelectUi.setValue(cameraId);
                cameraActionStartButton.click();
            } else {
                $this.persistedDataManager.resetLastUsedCameraId();
            }
        }
    }

    private createSectionSwap() {
        const $this = this;
        const TEXT_IF_CAMERA_SCAN_SELECTED
            = Html5QrcodeScannerStrings.textIfCameraScanSelected();
        const TEXT_IF_FILE_SCAN_SELECTED
            = Html5QrcodeScannerStrings.textIfFileScanSelected();

        const switchContainer = document.createElement("div");
        switchContainer.style.textAlign = "center";
        this.switchScanTypeLink
            = BaseUiElementFactory.createElement<HTMLAnchorElement>(
                "a", this.getDashboardSectionSwapLinkId());
        this.switchScanTypeLink.style.textDecoration = "underline";
        this.switchScanTypeLink.innerText
            = ScanTypeSelector.isCameraScanType(this.currentScanType)
                ? TEXT_IF_CAMERA_SCAN_SELECTED : TEXT_IF_FILE_SCAN_SELECTED;
        this.switchScanTypeLink.addEventListener("click", function () {
            // TODO(minhazav): Abstract this to a different library.
            if (!$this.sectionSwapAllowed) {
                if ($this.verbose) {
                    $this.logger.logError(
                        "Section swap called when not allowed");
                }
                return;
            }

            // Cleanup states
            $this.resetHeaderMessage();
            $this.fileSelectionUi!.resetValue();
            $this.sectionSwapAllowed = false;

            if (ScanTypeSelector.isCameraScanType($this.currentScanType)) {
                // Swap to file based scanning.
                $this.clearScanRegion();
                $this.scpCameraScanRegion!.style.display = "none";
                $this.fileSelectionUi!.show();
                $this.switchScanTypeLink!.innerText = TEXT_IF_FILE_SCAN_SELECTED;
                $this.currentScanType = Html5QrcodeScanType.SCAN_TYPE_FILE;
                $this.insertFileScanImageToScanRegion();
            } else {
                // Swap to camera based scanning.
                $this.clearScanRegion();
                $this.scpCameraScanRegion!.style.display = "block";
                $this.fileSelectionUi!.hide();
                $this.switchScanTypeLink!.innerText = TEXT_IF_CAMERA_SCAN_SELECTED;
                $this.currentScanType = Html5QrcodeScanType.SCAN_TYPE_CAMERA;
                $this.insertCameraScanImageToScanRegion();

                $this.startCameraScanIfPermissionExistsOnSwap();
            }

            $this.sectionSwapAllowed = true;
        });
        switchContainer.appendChild(this.switchScanTypeLink);
        this.dashboardSection!.appendChild(switchContainer);
    }

    // Start camera scanning automatically when swapping to camera based scan
    // if set in config and has permission.
    private startCameraScanIfPermissionExistsOnSwap() {
        const $this = this;
        if (this.persistedDataManager.hasCameraPermissions()) {
            CameraPermissions.hasPermissions().then(
                (hasPermissions: boolean) => {
                    if (hasPermissions) {
                        // Start feed.
                        // Assuming at this point the permission button exists.
                        if (!this.permissionButton) {
                            this.logger.logError(
                                "Permission button not found, fail;");
                            throw "Permission button not found";
                        }
                        this.permissionButton.click();
                    } else {
                        $this.persistedDataManager.setHasPermission(
                        /* hasPermission */ false);
                    }
                }).catch((_: any) => {
                    $this.persistedDataManager.setHasPermission(
                    /* hasPermission */ false);
                });
            return;
        }
    }

    private resetHeaderMessage() {
        this.headerMessageContainer!.style.display = "none";
    }

    private setHeaderMessage(
        messageText: string, scannerStatus?: Html5QrcodeScannerStatus) {
        if (!scannerStatus) {
            scannerStatus = Html5QrcodeScannerStatus.STATUS_DEFAULT;
        }

        this.headerMessageContainer!.innerText = messageText;
        this.headerMessageContainer!.style.display = "block";

        switch (scannerStatus) {
            case Html5QrcodeScannerStatus.STATUS_SUCCESS:
                this.headerMessageContainer!.style.background = "rgba(106, 175, 80, 0.26)";
                this.headerMessageContainer!.style.color = "#477735";
                break;
            case Html5QrcodeScannerStatus.STATUS_WARNING:
                this.headerMessageContainer!.style.background = "rgba(203, 36, 49, 0.14)";
                this.headerMessageContainer!.style.color = "#cb2431";
                break;
            case Html5QrcodeScannerStatus.STATUS_DEFAULT:
            default:
                this.headerMessageContainer!.style.background = "rgba(0, 0, 0, 0)";
                this.headerMessageContainer!.style.color = "rgb(17, 17, 17)";
                break;
        }
    }

    private showHideScanTypeSwapLink(shouldDisplay?: boolean) {
        if (this.scanTypeSelector.hasMoreThanOneScanType()) {
            if (shouldDisplay !== true) {
                shouldDisplay = false;
            }

            this.sectionSwapAllowed = shouldDisplay;
            this.switchScanTypeLink!.style.display
                = shouldDisplay ? "inline-block" : "none";
        }
    }

    private insertCameraScanImageToScanRegion() {
        const $this = this;

        if (this.cameraScanImage) {
            this.qrCodeScanRegion!.innerHTML = "<br>";
            this.qrCodeScanRegion!.appendChild(this.cameraScanImage);
            return;
        }

        this.cameraScanImage = new Image;
        this.cameraScanImage.onload = (_) => {
            this.qrCodeScanRegion!.innerHTML = "<br>";
            this.qrCodeScanRegion!.appendChild($this.cameraScanImage!);
        }
        this.cameraScanImage.width = 64;
        this.cameraScanImage.style.opacity = "0.8";
        this.cameraScanImage.src = ASSET_CAMERA_SCAN;
    }

    private insertFileScanImageToScanRegion() {
        const $this = this;
        if (this.fileScanImage) {
            this.qrCodeScanRegion!.innerHTML = "<br>";
            this.qrCodeScanRegion!.appendChild(this.fileScanImage);
            return;
        }

        this.fileScanImage = new Image;
        this.fileScanImage.onload = (_) => {
            this.qrCodeScanRegion!.innerHTML = "<br>";
            this.qrCodeScanRegion!.appendChild($this.fileScanImage!);
        }
        this.fileScanImage.width = 64;
        this.fileScanImage.style.opacity = "0.8";
        this.fileScanImage.src = ASSET_FILE_SCAN;
    }

    private clearScanRegion() {
        this.qrCodeScanRegion!.innerHTML = "";
    }

    //#region state getters
    private getDashboardSectionId(): string {
        return 'scanner__dashboard_section';
    }

    private getDashboardSectionCameraScanRegionId(): string {
        return 'scanner__dashboard_section_csr';
    }

    private getDashboardSectionSwapLinkId(): string {
        return PublicUiElementIdAndClasses.SCAN_TYPE_CHANGE_ANCHOR_ID;
    }

    private getScanRegionId(): string {
        return 'scanner__scan_region';
    }

    private getDashboardId(): string {
        return 'scanner__dashboard';
    }

    private getHeaderMessageContainerId(): string {
        return 'scanner__header_message';
    }

    private getCameraPermissionButtonId(): string {
        return PublicUiElementIdAndClasses.CAMERA_PERMISSION_BUTTON_ID;
    }
    //#endregion
    //#endregion
}
