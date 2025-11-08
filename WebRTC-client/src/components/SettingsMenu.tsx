import React, { useState, useEffect } from 'react';
import { Settings, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SettingsMenuOption {
    title: string;
    items: string[];
    defaultIndex?: number;
    type?: 'regular' | 'device';
    deviceType?: 'audioinput' | 'videoinput';
}

export interface SettingsMenuProps {
    options: SettingsMenuOption[];
    variant?: 'modern' | 'minimal';
    className?: string;
    onSelectionChange?: (optionIndex: number, selectedItem: string, selectedIndex: number) => void;
    onDeviceChange?: (deviceId: string, kind: 'audioinput' | 'videoinput') => void;
    getMediaDevices?: () => Promise<{ audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }>;
    getCurrentDevices?: () => { audioDeviceId?: string, videoDeviceId?: string };
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({
                                                       options: initialOptions,
                                                       variant = 'modern',
                                                       className,
                                                       onSelectionChange,
                                                       onDeviceChange,
                                                       getMediaDevices,
                                                       getCurrentDevices
                                                   }) => {
    const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
    const [openDropdowns, setOpenDropdowns] = useState<Set<number>>(new Set());
    const [isHovered, setIsHovered] = useState(false);
    const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
    const [options, setOptions] = useState(initialOptions);
    const [devices, setDevices] = useState<{ audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }>({
        audioInputs: [],
        videoInputs: []
    });

    // Initialize selected items
    useEffect(() => {
        const newSelectedItems = new Map(options.map((option, index) => [index, option.defaultIndex || 0]));
        setSelectedItems(newSelectedItems);
    }, [options]);

    // Load media devices
    useEffect(() => {
        const loadDevices = async () => {
            if (getMediaDevices) {
                try {
                    const deviceList = await getMediaDevices();
                    setDevices(deviceList);
                    updateDeviceOptions(deviceList);
                } catch (error) {
                    console.error('Failed to load media devices:', error);
                }
            }
        };

        if (isMainMenuOpen) {
            loadDevices();
        }
    }, [isMainMenuOpen, getMediaDevices]);

    const updateDeviceOptions = (deviceList: { audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }) => {
        const currentDevices = getCurrentDevices ? getCurrentDevices() : {};

        console.log('🔍 SettingsMenu updateDeviceOptions:', {
            currentDevices,
            audioDevices: deviceList.audioInputs.map(d => ({ id: d.deviceId, label: d.label })),
            videoDevices: deviceList.videoInputs.map(d => ({ id: d.deviceId, label: d.label }))
        });

        setOptions(prevOptions => {
            const newOptions = prevOptions.map((option, optionIndex) => {
                if (option.type === 'device') {
                    if (option.deviceType === 'audioinput') {
                        const devices = deviceList.audioInputs;
                        let currentIndex = -1;

                        if (currentDevices.audioDeviceId) {
                            currentIndex = devices.findIndex(device => device.deviceId === currentDevices.audioDeviceId);
                        }

                        console.log('🔍 Audio device matching:', {
                            currentDeviceId: currentDevices.audioDeviceId,
                            foundIndex: currentIndex,
                            availableDevices: devices.map(d => d.deviceId)
                        });

                        // Aggiorna la selectedItems se troviamo il device corrente
                        if (currentIndex !== -1) {
                            setTimeout(() => {
                                setSelectedItems(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(optionIndex, currentIndex);
                                    console.log('🔍 Updated audio selection to index:', currentIndex);
                                    return newMap;
                                });
                            }, 0);
                        }

                        return {
                            ...option,
                            items: devices.map(device => device.label || `Microfono ${device.deviceId.slice(0, 8)}`)
                        };
                    } else if (option.deviceType === 'videoinput') {
                        const devices = deviceList.videoInputs;
                        let currentIndex = -1;

                        if (currentDevices.videoDeviceId) {
                            currentIndex = devices.findIndex(device => device.deviceId === currentDevices.videoDeviceId);
                        }

                        console.log('🔍 Video device matching:', {
                            currentDeviceId: currentDevices.videoDeviceId,
                            foundIndex: currentIndex,
                            availableDevices: devices.map(d => d.deviceId)
                        });

                        // Aggiorna la selectedItems se troviamo il device corrente
                        if (currentIndex !== -1) {
                            setTimeout(() => {
                                setSelectedItems(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(optionIndex, currentIndex);
                                    console.log('🔍 Updated video selection to index:', currentIndex);
                                    return newMap;
                                });
                            }, 0);
                        }

                        return {
                            ...option,
                            items: devices.map(device => device.label || `Camera ${device.deviceId.slice(0, 8)}`)
                        };
                    }
                }
                return option;
            });

            return newOptions;
        });
    };


    const toggleMainMenu = () => {
        setIsMainMenuOpen(!isMainMenuOpen);
        if (isMainMenuOpen) {
            setOpenDropdowns(new Set());
        }
    };

    const toggleDropdown = (index: number) => {
        const newOpenDropdowns = new Set(openDropdowns);
        if (newOpenDropdowns.has(index)) {
            newOpenDropdowns.delete(index);
        } else {
            newOpenDropdowns.add(index);
        }
        setOpenDropdowns(newOpenDropdowns);
    };

    const selectItem = (optionIndex: number, itemIndex: number) => {
        const newSelectedItems = new Map(selectedItems);
        newSelectedItems.set(optionIndex, itemIndex);
        setSelectedItems(newSelectedItems);

        const option = options[optionIndex];
        const selectedItem = option.items[itemIndex];

        if (onSelectionChange) {
            onSelectionChange(optionIndex, selectedItem, itemIndex);
        }

        // Handle device changes
        if (option.type === 'device' && onDeviceChange && option.deviceType) {
            const deviceList = option.deviceType === 'audioinput' ? devices.audioInputs : devices.videoInputs;
            const device = deviceList[itemIndex];
            if (device) {
                onDeviceChange(device.deviceId, option.deviceType);
            }
        }

        // Close the dropdown after selection
        const newOpenDropdowns = new Set(openDropdowns);
        newOpenDropdowns.delete(optionIndex);
        setOpenDropdowns(newOpenDropdowns);
    };

    const baseButtonStyles = {
        modern: "bg-gradient-modern hover:bg-gradient-modern-hover border border-primary/20 shadow-modern hover:shadow-glow-intense backdrop-blur-sm ring-1 ring-primary/10 hover:ring-primary/30 transition-all duration-400",
        minimal: "bg-secondary hover:bg-accent border border-border hover:border-primary/30 transition-all duration-200"
    };

    const baseMenuStyles = {
        modern: "bg-card border border-border shadow-lg backdrop-blur-lg",
        minimal: "bg-popover border border-border shadow-lg"
    };

    const dropdownStyles = {
        modern: "bg-card border border-border shadow-md",
        minimal: "bg-card border border-border shadow-md"
    };

    return (
        <div className={cn("relative inline-block", className)}>
            {/* Settings Button */}
            <button
                onClick={toggleMainMenu}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={cn(
                    "relative overflow-hidden transition-all duration-400 group",
                    variant === 'modern'
                        ? "p-3 rounded-xl " + baseButtonStyles[variant]
                        : "p-3 rounded-lg " + baseButtonStyles[variant]
                )}
                aria-label="Open settings menu"
            >
                {/* Animated background for modern variant */}
                {variant === 'modern' && (
                    <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-100 transition-opacity duration-400" />
                )}

                <Settings
                    className={cn(
                        "relative z-10 transition-all duration-400 ease-out",
                        variant === 'modern'
                            ? "w-6 h-6 text-primary group-hover:text-primary-foreground"
                            : "w-5 h-5 text-foreground",
                    )}
                    style={{
                        transform: (isMainMenuOpen || (isHovered && !isMainMenuOpen)) ? 'rotate(90deg)' : 'rotate(0deg)'
                    }}
                />
            </button>

            {/* Main Menu */}
            {isMainMenuOpen && (
                <div
                    className={cn(
                        "absolute right-0 mt-3 w-80 max-h-[70vh] overflow-y-auto rounded-xl animate-dropdown-fade-in",
                        "z-[1000] bg-card border border-border shadow-lg",
                        variant === 'modern'
                            ? "p-4 " + baseMenuStyles[variant] + " font-space"
                            : "p-4 " + baseMenuStyles[variant] + " font-inter"
                    )}
                >
                    {/* Modern variant header */}
                    {variant === 'modern' && (
                        <div className="mb-4 pb-3 border-b border-primary/20">
                            <h2 className="text-base font-semibold text-primary bg-gradient-primary bg-clip-text">
                                Impostazioni
                            </h2>
                            <p className="text-xs text-muted-foreground mt-1 font-inter">
                                Personalizza la tua esperienza
                            </p>
                        </div>
                    )}

                    <div className={cn("space-y-3", variant === 'minimal' && "space-y-3")}>
                        {options.map((option, optionIndex) => (
                            <div key={optionIndex} className="space-y-2">
                                {/* Option Title */}
                                <h3 className={cn(
                                    "font-medium text-foreground tracking-wide",
                                    variant === 'modern'
                                        ? "text-xs text-primary font-space font-medium"
                                        : "text-xs font-inter"
                                )}>
                                    {option.title}
                                    {option.type === 'device' && (
                                        <span className="ml-2 text-xs text-muted-foreground">
                                            ({option.items.length} disponibili)
                                        </span>
                                    )}
                                </h3>

                                {/* Dropdown Button */}
                                <button
                                    onClick={() => toggleDropdown(optionIndex)}
                                    className={cn(
                                        "w-full flex items-center justify-between text-left transition-all group",
                                        variant === 'modern'
                                            ? "p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 border border-primary/10 hover:border-primary/25 hover:shadow-modern duration-300 font-space"
                                            : "p-2 rounded-md bg-secondary hover:bg-accent border border-border hover:border-primary/30 duration-200 font-inter"
                                    )}
                                >
                                    <span className={cn(
                                        "text-foreground truncate",
                                        variant === 'modern' ? "text-xs font-medium" : "text-xs"
                                    )}>
                                        {option.items[selectedItems.get(optionIndex) || 0] || 'Nessun dispositivo'}
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "text-muted-foreground transition-all duration-300 flex-shrink-0",
                                            variant === 'modern' ? "w-4 h-4 ml-2" : "w-4 h-4 ml-2"
                                        )}
                                        style={{
                                            transform: openDropdowns.has(optionIndex) ? 'rotate(180deg)' : 'rotate(0deg)'
                                        }}
                                    />
                                </button>

                                {/* Dropdown Items */}
                                {openDropdowns.has(optionIndex) && (
                                    <div
                                        className={cn(
                                            "animate-dropdown-fade-in overflow-hidden max-h-48 overflow-y-auto",
                                            variant === 'modern'
                                                ? "rounded-lg p-1 " + dropdownStyles[variant]
                                                : "rounded-md p-1 " + dropdownStyles[variant]
                                        )}
                                    >
                                        {option.items.length > 0 ? (
                                            option.items.map((item, itemIndex) => (
                                                <button
                                                    key={itemIndex}
                                                    onClick={() => selectItem(optionIndex, itemIndex)}
                                                    className={cn(
                                                        "w-full text-left transition-all duration-200 group",
                                                        variant === 'modern'
                                                            ? "p-2 rounded-md text-xs font-space font-medium"
                                                            : "p-2 rounded-sm text-xs font-inter",
                                                        selectedItems.get(optionIndex) === itemIndex
                                                            ? variant === 'modern'
                                                                ? "bg-gradient-primary text-primary-foreground shadow-modern"
                                                                : "bg-accent text-accent-foreground"
                                                            : variant === 'modern'
                                                                ? "text-foreground hover:bg-secondary/40 hover:text-primary"
                                                                : "text-foreground hover:bg-secondary/50"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="truncate">{item}</span>
                                                        {selectedItems.get(optionIndex) === itemIndex && variant === 'modern' && (
                                                            <div className="w-2 h-2 rounded-full bg-primary-foreground opacity-80 flex-shrink-0 ml-2" />
                                                        )}
                                                    </div>
                                                </button>
                                            ))
                                        ) : (
                                            <div className="p-2 text-xs text-muted-foreground text-center">
                                                Nessun dispositivo disponibile
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Modern variant footer */}
                    {variant === 'modern' && (
                        <div className="mt-4 pt-3 border-t border-primary/20">
                            <p className="text-xs text-muted-foreground font-inter">
                                Le modifiche vengono salvate automaticamente
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Backdrop */}
            {isMainMenuOpen && (
                <div
                    className="fixed inset-0 z-[900]"
                    onClick={toggleMainMenu}
                    aria-hidden="true"
                />
            )}
        </div>
    );
};

export default SettingsMenu;
